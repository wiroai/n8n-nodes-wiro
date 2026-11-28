import type {
	FieldType,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
	ResourceMapperField,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const API_BASE = 'https://api.wiro.ai/v1';

type WiroContext = IExecuteFunctions | ILoadOptionsFunctions;

/** One input of a model, as Tool/Detail lists it. */
export interface ModelParameter {
	id: string;
	type: string;
	label?: string;
	note?: string;
	required?: boolean;
	advanced?: boolean;
	defaultvalue?: unknown;
	maxinputlength?: string | number | null;
	options?: Array<{ text?: string; value?: unknown }>;
}

const FILE_TYPES = new Set(['fileinput', 'combinefileinput', 'multifileinput', 'multifileinputdrop']);
const NUMBER_TYPES = new Set(['number', 'float', 'range']);
// Inputs that hold sample content in the catalog: they start empty instead of taking the sample.
const SAMPLE_ID = /prompt|input|messages|tools|tooloutputs|tool_choice|previoustasktoken/i;

// Letters of scripts other than Latin (Greek, Cyrillic, Hebrew, Arabic, Devanagari, Thai, Hangul, CJK,
// full-width forms) and the letters only Turkish uses. Text from the catalog that holds them is not
// shown in the node, which keeps the node's interface in English.
const NON_ENGLISH_RANGES: Array<[number, number]> = [
	[0x0370, 0x03ff], // Greek
	[0x0400, 0x04ff], // Cyrillic
	[0x0590, 0x05ff], // Hebrew
	[0x0600, 0x06ff], // Arabic
	[0x0900, 0x097f], // Devanagari
	[0x0e00, 0x0e7f], // Thai
	[0x1100, 0x11ff], // Hangul jamo
	[0x3000, 0x9fff], // CJK symbols, kana and ideographs
	[0xac00, 0xd7af], // Hangul syllables
	[0xf900, 0xfaff], // CJK compatibility ideographs
	[0xff00, 0xffef], // Full-width forms
];
const TURKISH_ONLY_LETTERS = new Set([0x011e, 0x011f, 0x015e, 0x015f, 0x0130, 0x0131]);

function hasNonEnglishLetters(text: string): boolean {
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (TURKISH_ONLY_LETTERS.has(code)) return true;
		if (NON_ENGLISH_RANGES.some(([first, last]) => code >= first && code <= last)) return true;
	}
	return false;
}

// English names for the Chinese dialects that some speech models list only in Chinese.
const DIALECT_NAMES: Record<string, string> = {
	'\u4e1c\u5317\u8bdd': 'Northeastern Mandarin Dialect',
	'\u4e91\u5357\u8bdd': 'Yunnan Dialect',
	'\u56db\u5ddd\u8bdd': 'Sichuan Dialect',
	'\u5b81\u590f\u8bdd': 'Ningxia Dialect',
	'\u6842\u6797\u8bdd': 'Guilin Dialect',
	'\u6cb3\u5357\u8bdd': 'Henan Dialect',
	'\u6d4e\u5357\u8bdd': 'Jinan Dialect',
	'\u7518\u8083\u8bdd': 'Gansu Dialect',
	'\u77f3\u5bb6\u5e84\u8bdd': 'Shijiazhuang Dialect',
	'\u8d35\u5dde\u8bdd': 'Guizhou Dialect',
	'\u9655\u897f\u8bdd': 'Shaanxi Dialect',
	'\u9752\u5c9b\u8bdd': 'Qingdao Dialect',
};

/**
 * Catalog text as the node shows it, or undefined when it is not English. Math-styled letters
 * become plain ones, and the Greek mu of names such as "G.711 mu-law" is written as "mu".
 */
export function englishText(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	const text = String(value)
		.normalize('NFKC')
		.replace(/[\u00b5\u03bc]/g, 'mu')
		.replace(/\s+/g, ' ')
		.trim();
	return hasNonEnglishLetters(text) ? undefined : text;
}

/**
 * The English name of a select option: the name itself, its English half ("Male" from "Male - " followed by Chinese),
 * the English name of a dialect, the option's value, or its position in the list.
 */
export function optionName(option: { text?: string; value?: unknown }, index: number): string {
	const raw = String(option.text ?? option.value ?? '').trim();
	const dialect = DIALECT_NAMES[raw];
	if (dialect) return dialect;
	const name = englishText(raw);
	if (name) return name;
	const halves = raw
		.split(/\s+[-|/]\s+/)
		.map((half) => englishText(half))
		.filter((half): half is string => !!half);
	if (halves.length > 0) return halves.join(' - ');
	const value = englishText(String(option.value ?? '').replace(/[_-]+/g, ' '));
	if (value) return titleCase(value);
	return `Option ${index + 1}`;
}

const API_MESSAGES: Record<string, { message: string; description: string }> = {
	'request-files-required': {
		message: 'This model needs a file',
		description: "Fill the model's file input with a public URL, then run the node again.",
	},
	'tool-not-accessible': {
		message: 'This model is not available',
		description: 'Pick another model from the list in the Model field.',
	},
	'insufficient-balance': {
		message: 'Your Wiro wallet has too little credit for this run',
		description: 'Add credit in your Wiro dashboard at https://wiro.ai/panel, then run the node again.',
	},
};

function readableCode(code: string): string {
	const text = code.replace(/[-_]+/g, ' ').trim();
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Wiro did not accept the request';
}

/** A POST to the Wiro API. Wiro answers some refusals with HTTP 200 and `result: false`. */
export async function wiroRequest(
	this: WiroContext,
	path: string,
	body: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	let response: IDataObject;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'wiroAiApi', {
			method: 'POST',
			url: `${API_BASE}${path}`,
			body,
			json: true,
		})) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}

	if (response?.result === false) {
		const errors = (response.errors as Array<{ message?: string }> | undefined) ?? [];
		const code = String(errors[0]?.message ?? '');
		const known = API_MESSAGES[code];
		throw new NodeApiError(this.getNode(), response as JsonObject, {
			itemIndex,
			message: known?.message ?? readableCode(code),
			description: known?.description ?? `Wiro answered: ${code || 'no details'}`,
		});
	}
	return response;
}

/** "owner/model" from the Model field, as two parts for the Run URL. */
export function splitModel(this: WiroContext, model: string, itemIndex?: number): [string, string] {
	const match = /^([^/\s]+)\/([^/\s]+)$/.exec(model.trim());
	if (!match) {
		throw new NodeOperationError(this.getNode(), `The model "${model}" is not in the form owner/model`, {
			itemIndex,
			description: 'Pick a model from the list in the Model field, or enter it as owner/model, for example pruna/p-image.',
		});
	}
	return [match[1], match[2]];
}

/** The inputs a model takes, from Tool/Detail. */
export async function getModelParameters(
	this: WiroContext,
	model: string,
	itemIndex?: number,
): Promise<ModelParameter[]> {
	const [owner, project] = splitModel.call(this, model, itemIndex);
	const response = await wiroRequest.call(this, '/Tool/Detail', { slugowner: owner, slugproject: project }, itemIndex);
	const tool = ((response.tool as IDataObject[] | undefined) ?? [])[0];
	const groups = ((tool?.parameters as Array<{ items?: ModelParameter[] }> | undefined) ?? []);
	const seen = new Set<string>();
	const parameters: ModelParameter[] = [];
	for (const group of groups) {
		for (const item of group.items ?? []) {
			if (!item?.id || seen.has(item.id)) continue;
			seen.add(item.id);
			parameters.push(item);
		}
	}
	return parameters;
}

function titleCase(text: string): string {
	return text.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

/** A readable label: the catalog label, or the input's id when the label is a key or missing. */
export function inputLabel(parameter: ModelParameter): string {
	// A label in another language falls back to the input's id, like a missing one.
	const label = englishText(parameter.label) ?? '';
	const looksLikeKey = !label || /^[a-z0-9]+(-[a-z0-9]+)+$/.test(label);
	const base = looksLikeKey
		? parameter.id.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		: label;
	const words = titleCase(base.replace(/\bid\b/gi, 'ID').replace(/\burl\b/gi, 'URL'));
	if (FILE_TYPES.has(parameter.type)) {
		return /url/i.test(words) ? words : `${words} ${parameter.type === 'fileinput' ? 'URL' : 'URLs'}`;
	}
	return words;
}

function takesSeveralFiles(parameter: ModelParameter): boolean {
	if (parameter.type === 'multifileinput' || parameter.type === 'multifileinputdrop') return true;
	if (parameter.type !== 'combinefileinput') return false;
	const capacity = Number(parameter.maxinputlength ?? 1);
	return Number.isFinite(capacity) && capacity > 1;
}

function isSample(parameter: ModelParameter): boolean {
	return FILE_TYPES.has(parameter.type) || parameter.type === 'textarea' || SAMPLE_ID.test(parameter.id);
}

function fieldType(parameter: ModelParameter): FieldType {
	if (NUMBER_TYPES.has(parameter.type)) return 'number';
	if (parameter.type === 'checkbox') return 'boolean';
	if (parameter.type === 'select' && (parameter.options ?? []).length > 0) return 'options';
	if (parameter.type === 'json') return 'object';
	if (parameter.type === 'json-array') return 'array';
	return 'string';
}

function fieldDefault(parameter: ModelParameter, type: FieldType): string | number | boolean | null | undefined {
	if (isSample(parameter)) return undefined;
	const value = parameter.defaultvalue;
	if (value === undefined || value === null || value === '' || Array.isArray(value)) return undefined;
	if (type === 'number') {
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	}
	if (type === 'boolean') return String(value).toLowerCase() === 'true';
	if (type === 'object' || type === 'array') return undefined;
	// An option's value is not shown, only its English name, so it stays as the API takes it.
	if (type === 'options') return String(value);
	// A default in another language is left out of the field; the run still sends the model's default.
	return englishText(value);
}

/** The Inputs mapper's fields for one model. Advanced optional inputs start hidden but can be added. */
export function toMapperFields(parameters: ModelParameter[]): ResourceMapperField[] {
	return parameters.map((parameter) => {
		const type = fieldType(parameter);
		const field: ResourceMapperField = {
			id: parameter.id,
			displayName: takesSeveralFiles(parameter) ? `${inputLabel(parameter)} (Comma-Separated)` : inputLabel(parameter),
			required: parameter.required === true,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			removed: parameter.advanced === true && parameter.required !== true,
			type,
		};
		if (type === 'options') {
			field.options = (parameter.options ?? [])
				.filter((option) => option.value !== undefined && option.value !== null)
				.map(
					(option, index): INodePropertyOptions => ({
						name: optionName(option, index),
						value: String(option.value),
					}),
				);
		}
		const defaultValue = fieldDefault(parameter, type);
		if (defaultValue !== undefined) field.defaultValue = defaultValue;
		return field;
	});
}

/** Public file URLs from a field: one URL, several separated by commas or new lines, or a list. */
export function fileUrlList(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(fileUrlList);
	if (typeof value !== 'string') return [];
	return value
		.split(/[\n,]+/)
		.map((url) => url.trim())
		.filter((url) => url !== '');
}

function isEmpty(value: unknown): boolean {
	return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * The Run request body. Inputs left empty take the model's default, except sample inputs (prompts,
 * files, chat fields), which stay out. File URLs go where Run reads them: a single file field in
 * {id}Url, a combined field as a list in {id}, a multi-file field comma-separated in
 * {id without "Multiple"}UrlMultiple.
 */
export function buildRunBody(parameters: ModelParameter[], values: IDataObject): IDataObject {
	const body: IDataObject = {};
	for (const parameter of parameters) {
		const value = values[parameter.id];
		if (FILE_TYPES.has(parameter.type)) {
			const urls = fileUrlList(value);
			if (urls.length === 0) continue;
			if (parameter.type === 'fileinput') body[`${parameter.id}Url`] = urls[0];
			else if (parameter.type === 'combinefileinput') body[parameter.id] = urls;
			else body[`${parameter.id.replace('Multiple', '')}UrlMultiple`] = urls.join(',');
			continue;
		}
		if (!isEmpty(value)) {
			if ((parameter.type === 'json' || parameter.type === 'json-array') && typeof value === 'string') {
				try {
					body[parameter.id] = JSON.parse(value);
				} catch {
					body[parameter.id] = value;
				}
			} else {
				body[parameter.id] = value as IDataObject[keyof IDataObject];
			}
			continue;
		}
		if (isSample(parameter)) continue;
		const fallback = parameter.defaultvalue;
		if (!isEmpty(fallback)) body[parameter.id] = fallback as IDataObject[keyof IDataObject];
	}
	return body;
}

/** A text model's reply: the answer parts of a raw output, or the older message field. */
export function replyText(content: unknown): string | undefined {
	if (!content || typeof content !== 'object') return undefined;
	const { answer, message, raw } = content as { answer?: unknown; message?: unknown; raw?: unknown };
	if (Array.isArray(answer)) {
		const text = answer
			.map((part) => {
				if (typeof part === 'string') return part;
				const partText = (part as { text?: unknown } | null)?.text;
				return typeof partText === 'string' ? partText : '';
			})
			.join('');
		if (text) return text;
	} else if (typeof answer === 'string' && answer) {
		return answer;
	}
	if (typeof message === 'string' && message) return message;
	if (typeof raw === 'string' && raw) return raw;
	return undefined;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Where a task stands. The exit code decides success: a task can end without its outputs. */
export function taskStatus(task: IDataObject): TaskStatus {
	const status = String(task.status ?? '');
	if (status === 'task_cancel') return 'cancelled';
	if (status === 'task_postprocess_end') return String(task.pexit ?? '') === '0' ? 'completed' : 'failed';
	if (status === 'task_queue' || status === '') return 'queued';
	return 'running';
}

/** A task as the node outputs it, in at most ten fields: the file links and the text reply first. */
export function taskOutput(task: IDataObject): IDataObject {
	const outputs = (task.outputs as IDataObject[] | undefined) ?? [];
	const urls = outputs.map((output) => output.url).filter((url): url is string => typeof url === 'string' && url !== '');
	const output: IDataObject = {
		taskId: String(task.id ?? ''),
		status: taskStatus(task),
		model: task.modelslugowner ? `${task.modelslugowner}/${task.modelslugproject}` : '',
		url: urls[0] ?? '',
		urls,
	};
	const text = replyText(outputs[0]?.content);
	if (text !== undefined) output.text = text;
	if (task.totalcost !== undefined && task.totalcost !== null) output.costUsd = Number(task.totalcost);
	if (task.elapsedseconds !== undefined && task.elapsedseconds !== null) output.elapsedSeconds = Number(task.elapsedseconds);
	return output;
}

/** One Task/Detail read, by task ID or by the token Run returns. */
export async function getTask(
	this: IExecuteFunctions,
	reference: { taskid?: string; tasktoken?: string },
	itemIndex: number,
): Promise<IDataObject> {
	const response = await wiroRequest.call(this, '/Task/Detail', reference as IDataObject, itemIndex);
	const task = ((response.tasklist as IDataObject[] | undefined) ?? [])[0];
	if (!task) {
		throw new NodeOperationError(this.getNode(), 'No task was found for this ID', {
			itemIndex,
			description: 'Use a task ID from a Wiro AI node run in the same Wiro project as this credential.',
		});
	}
	return task;
}

// Fast models finish in seconds and video models can take many minutes: check often at first,
// then less often.
function nextPollDelayMs(elapsedMs: number): number {
	if (elapsedMs < 10_000) return 2_000;
	if (elapsedMs < 60_000) return 5_000;
	if (elapsedMs < 300_000) return 10_000;
	return 20_000;
}

/** Reads the task until it ends or the wait runs out, then returns it as it stands. */
export async function waitForTask(
	this: IExecuteFunctions,
	reference: { taskid?: string; tasktoken?: string },
	maxWaitMs: number,
	itemIndex: number,
): Promise<IDataObject> {
	const startedAt = Date.now();
	for (;;) {
		const task = await getTask.call(this, reference, itemIndex);
		const status = taskStatus(task);
		if (status === 'completed' || status === 'failed' || status === 'cancelled') return task;
		const elapsed = Date.now() - startedAt;
		if (elapsed >= maxWaitMs) return task;
		await sleep(Math.min(nextPollDelayMs(elapsed), Math.max(1_000, maxWaitMs - elapsed)));
	}
}
