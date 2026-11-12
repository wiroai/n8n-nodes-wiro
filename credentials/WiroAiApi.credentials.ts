import { createHmac } from 'crypto';
import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class WiroAiApi implements ICredentialType {
	name = 'wiroAiApi';

	displayName = 'Wiro AI API';

	icon: Icon = { light: 'file:wiro.svg', dark: 'file:wiro.dark.svg' };

	documentationUrl = 'https://wiro.ai/docs/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'The API key of your Wiro project. Create a project at https://wiro.ai/panel/project/new to get one.',
		},
		{
			displayName: 'API Secret',
			name: 'apiSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The API secret of a project that uses signature authentication. Leave it empty for a project that uses the API key only.',
		},
	];

	// A signature project sends a fresh HMAC-SHA256 signature with every request: the key signs
	// the secret followed by a Unix timestamp, so the secret itself never leaves n8n.
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const apiKey = String(credentials.apiKey ?? '');
		const apiSecret = String(credentials.apiSecret ?? '');
		const headers: Record<string, string> = { 'x-api-key': apiKey };

		if (apiSecret) {
			const nonce = Math.floor(Date.now() / 1000).toString();
			headers['x-nonce'] = nonce;
			headers['x-signature'] = createHmac('sha256', apiKey).update(apiSecret + nonce).digest('hex');
		}

		return {
			...requestOptions,
			headers: { ...requestOptions.headers, ...headers },
		};
	}

	test: ICredentialTestRequest = {
		request: {
			method: 'POST',
			baseURL: 'https://api.wiro.ai/v1',
			url: '/Task/Detail',
			body: { tasktoken: 'credential-test' },
		},
	};
}
