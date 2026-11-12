import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildRunBody,
	englishText,
	getModelParameters,
	getTask,
	splitModel,
	taskOutput,
	taskStatus,
	toMapperFields,
	waitForTask,
	wiroRequest,
} from './GenericFunctions';

export class Wiro implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wiro AI',
		name: 'wiro',
		icon: { light: 'file:wiro.svg', dark: 'file:wiro.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ $parameter["resource"] === "task" ? ($parameter["operation"] === "wait" ? "Wait for a task" : "Get a task") : ((typeof $parameter["model"] === "string" ? $parameter["model"] : ($parameter["model"] || {}).value) || "Run a model") }}',
		description: 'Run 1,000+ AI models for video, images, audio, text and 3D with Wiro AI',
		defaults: {
			name: 'Wiro AI',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'wiroAiApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Model',
						value: 'model',
					},
					{
						name: 'Task',
						value: 'task',
					},
				],
				default: 'model',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['model'],
					},
				},
				options: [
					{
						name: 'Run',
						value: 'run',
						description: 'Run a model with your inputs and get its outputs',
						action: 'Run a model',
					},
				],
				default: 'run',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Retrieve a task with its status and outputs',
						action: 'Get a task',
					},
					{
						name: 'Wait',
						value: 'wait',
						description: 'Wait until a task finishes, then retrieve its outputs',
						action: 'Wait for a task',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The Wiro model to run',
				displayOptions: {
					show: {
						resource: ['model'],
						operation: ['run'],
					},
				},
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a model...',
						typeOptions: {
							searchListMethod: 'searchModels',
							searchable: true,
						},
					},
					{
						displayName: 'By URL',
						name: 'url',
						type: 'string',
						placeholder: 'e.g. https://wiro.ai/models/pruna/p-image',
						validation: [
							{
								type: 'regex',
								properties: {
									regex: 'https://(?:www\\.)?wiro\\.ai/models/[^/\\s]+/[^/?#\\s]+.*',
									errorMessage: 'Not a Wiro model URL',
								},
							},
						],
						extractValue: {
							type: 'regex',
							regex: 'https://(?:www\\.)?wiro\\.ai/models/([^/\\s]+/[^/?#\\s]+)',
						},
					},
					{
						displayName: 'By Slug',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. pruna/p-image',
						validation: [
							{
								type: 'regex',
								properties: {
									regex: '[^/\\s]+/[^/\\s]+',
									errorMessage: 'Enter the model as owner/model',
								},
							},
						],
					},
				],
			},
			{
				displayName: 'Inputs',
				name: 'inputs',
				type: 'resourceMapper',
				noDataExpression: true,
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['model.value'],
					resourceMapper: {
						resourceMapperMethod: 'getModelInputs',
						mode: 'add',
						fieldWords: {
							singular: 'input',
							plural: 'inputs',
						},
						addAllFields: true,
						supportAutoMap: false,
						hideNoDataError: true,
					},
				},
				displayOptions: {
					show: {
						resource: ['model'],
						operation: ['run'],
					},
				},
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description:
					'Whether to wait for the task to finish and return its outputs. Turn it off to get the task ID at once and read the task later with Task > Get or Task > Wait.',
				displayOptions: {
					show: {
						resource: ['model'],
						operation: ['run'],
					},
				},
			},
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 5986221',
				description: 'The ID of a task that a Wiro AI node started, from its Task ID output field',
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
			},
			{
				displayName: 'Max Wait Time (Minutes)',
				name: 'maxWaitMinutes',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 120,
				},
				default: 20,
				description: 'How long to wait for the task. A task still running after this time comes back with status running.',
				displayOptions: {
					show: {
						resource: ['model'],
						operation: ['run'],
						waitForCompletion: [true],
					},
				},
			},
			{
				displayName: 'Max Wait Time (Minutes)',
				name: 'maxWaitMinutes',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 120,
				},
				default: 20,
				description: 'How long to wait for the task. A task still running after this time comes back with status running.',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['wait'],
					},
				},
			},
		],
	};

	methods = {
		listSearch: {
			async searchModels(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const start = Number(paginationToken ?? 0) || 0;
				const search = (filter ?? '').trim().slice(0, 200);
				const response = await wiroRequest.call(this, '/Tool/List', {
					start: String(start),
					limit: '50',
					categories: ['tool'],
					hideworkflows: true,
					summary: true,
					...(search ? { search, sort: 'relevance', order: 'DESC' } : {}),
				});
				const tools = (response.tool as IDataObject[] | undefined) ?? [];
				const total = Number(response.total ?? 0);
				return {
					results: tools.map((tool) => {
						const slug = `${tool.cleanslugowner}/${tool.cleanslugproject}`;
						return {
							name: slug,
							value: slug,
							description: englishText(tool.title),
							url: `https://wiro.ai/models/${slug}`,
						};
					}),
					paginationToken: start + tools.length < total && tools.length > 0 ? String(start + tools.length) : undefined,
				};
			},
		},
		resourceMapping: {
			async getModelInputs(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const model = this.getNodeParameter('model', '', { extractValue: true }) as string;
				if (!model) return { fields: [] };
				const parameters = await getModelParameters.call(this, model);
				return {
					fields: toMapperFields(parameters),
					emptyFieldsNotice: 'This model takes no inputs',
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		// The same model's inputs are read once per execution, not once per item.
		const parametersByModel = new Map<string, Awaited<ReturnType<typeof getModelParameters>>>();

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'model' && operation === 'run') {
					const model = (this.getNodeParameter('model', i, '', { extractValue: true }) as string).trim();
					const [owner, project] = splitModel.call(this, model, i);
					let parameters = parametersByModel.get(model);
					if (!parameters) {
						parameters = await getModelParameters.call(this, model, i);
						parametersByModel.set(model, parameters);
					}
					const values = (this.getNodeParameter('inputs.value', i, {}) as IDataObject | null) ?? {};
					const run = await wiroRequest.call(this, `/Run/${owner}/${project}`, buildRunBody(parameters, values), i);
					const taskToken = typeof run.socketaccesstoken === 'string' ? run.socketaccesstoken : '';
					if (!run.taskid || !taskToken) {
						throw new NodeApiError(this.getNode(), run as JsonObject, {
							itemIndex: i,
							message: 'Wiro did not start a task for this run',
							description: 'Check the inputs of the model and run the node again.',
						});
					}

					if (!(this.getNodeParameter('waitForCompletion', i, true) as boolean)) {
						returnData.push({
							json: { taskId: String(run.taskid), status: 'queued', model },
							pairedItem: { item: i },
						});
						continue;
					}

					const maxWaitMs = (this.getNodeParameter('maxWaitMinutes', i, 20) as number) * 60_000;
					const task = await waitForTask.call(this, { tasktoken: taskToken }, maxWaitMs, i);
					assertTaskDidNotFail.call(this, task, i);
					returnData.push({ json: taskOutput(task), pairedItem: { item: i } });
					continue;
				}

				if (resource === 'task') {
					const taskId = String(this.getNodeParameter('taskId', i)).trim();
					if (!/^\d+$/.test(taskId)) {
						throw new NodeOperationError(this.getNode(), `"${taskId}" is not a task ID`, {
							itemIndex: i,
							description: "Use the number in the 'Task ID' output field of a Wiro AI node, for example 5986221.",
						});
					}
					const task =
						operation === 'wait'
							? await waitForTask.call(
									this,
									{ taskid: taskId },
									(this.getNodeParameter('maxWaitMinutes', i, 20) as number) * 60_000,
									i,
								)
							: await getTask.call(this, { taskid: taskId }, i);
					if (operation === 'wait') assertTaskDidNotFail.call(this, task, i);
					returnData.push({ json: taskOutput(task), pairedItem: { item: i } });
					continue;
				}

				throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
					itemIndex: i,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Both classes hand back an error of their own kind unchanged.
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** A finished task that failed or was cancelled stops the node, so the error output can take it. */
function assertTaskDidNotFail(this: IExecuteFunctions, task: IDataObject, itemIndex: number): void {
	const status = taskStatus(task);
	if (status !== 'failed' && status !== 'cancelled') return;
	throw new NodeApiError(this.getNode(), task as JsonObject, {
		itemIndex,
		message: status === 'cancelled' ? `Task ${task.id} was cancelled` : `The model could not finish task ${task.id}`,
		description:
			status === 'cancelled'
				? 'Run the model again to start a new task.'
				: 'Check the inputs, for example that file URLs are public, then run the node again.',
	});
}
