import {
  INodeType,
  INodeTypeDescription,
  IDataObject,
  ITriggerFunctions,
  ITriggerResponse,
	NodeApiError,
	NodeOperationError,
  ICredentialDataDecryptedObject,
	NodeConnectionType
} from 'n8n-workflow';
import { io, Socket } from 'socket.io-client';

export class HomeAssistantTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Home Assistant Trigger',
        name: 'homeAssistantTrigger',
        icon: 'file:homeAssistant.svg',
        group: ['trigger'],
        version: 1,
        description: 'Triggers the workflow when a state changes in Home Assistant',
        defaults: {
            name: 'Home Assistant Trigger',
        },
        inputs: [],
        outputs: [NodeConnectionType.main],
        credentials: [
            {
                name: 'homeAssistantApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'WebSocket URL',
                name: 'wsUrl',
                type: 'string',
                default: 'ws://localhost:8123/api/websocket',
                required: true,
                description: 'The WebSocket URL of the Home Assistant instance',
            },
            {
                displayName: 'Event Type',
                name: 'eventType',
                type: 'string',
                default: 'state_changed',
                required: true,
                description: 'The type of event to subscribe to (e.g., state_changed, subscribe_trigger, *)',
            },
            {
                displayName: 'Entity ID',
                name: 'entityId',
                type: 'string',
                default: '',
                description: 'The ID of the entity to monitor (leave empty to monitor all entities)',
            },
            {
                displayName: 'From State',
                name: 'fromState',
                type: 'string',
                default: '',
                description: 'The state to transition from (only for subscribe_trigger)',
            },
            {
                displayName: 'To State',
                name: 'toState',
                type: 'string',
                default: '',
                description: 'The state to transition to (only for subscribe_trigger)',
            },
            {
                displayName: 'Include Event Data',
                name: 'includeEventData',
                type: 'boolean',
                default: true,
                description: 'Whether to include the event data in the output',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const wsUrl = this.getNodeParameter('wsUrl') as string;
		const eventType = this.getNodeParameter('eventType') as string;
		const entityId = this.getNodeParameter('entityId') as string;
		const fromState = this.getNodeParameter('fromState') as string;
		const toState = this.getNodeParameter('toState') as string;
		const includeEventData = this.getNodeParameter('includeEventData') as boolean;

		const credentials = await this.getCredentials('homeAssistantApi') as ICredentialDataDecryptedObject;

		if (!credentials) {
			throw new NodeOperationError(this.getNode(), 'No credentials returned!');
		}

		const socket: Socket = io(wsUrl, {
			auth: {
				token: credentials.authToken as string,
			},
			autoConnect: false,
		});

		async function closeFunction() {
			if (socket.connected) {
				console.log('Disconnecting from Home Assistant WebSocket');
				socket.disconnect();
			}
		}

		try {
			socket.connect();

			socket.on('connect', () => {
				console.log('Connected to Home Assistant WebSocket');
				socket.emit('auth', { access_token: credentials.authToken });
			});

			socket.on('connect_error', (error) => {
				throw new NodeApiError(this.getNode(), {
					message: 'WebSocket connection error',
					description: error.message,
				});
			});

			socket.on('auth_ok', () => {
				console.log('Authentication successful');
				console.log(`Subscribing to ${eventType}...`);

				if (eventType === 'subscribe_trigger') {
					const entityIds = entityId.split(',').map(id => id.trim());
					const triggerCondition: IDataObject = {
						platform: 'state',
						entity_id: entityIds,
					};
					if (fromState) {
						triggerCondition.from = fromState.split(',').map(state => state.trim());
					}
					if (toState) {
						triggerCondition.to = toState.split(',').map(state => state.trim());
					}
					console.log(`Trigger condition: ${JSON.stringify(triggerCondition)}`);
					socket.emit('subscribe_trigger', {
						type: eventType,
						trigger: triggerCondition,
					});
				} else if (eventType === '*') {
					console.log('Subscribing to all events');
					socket.emit('subscribe_events', { event_type: '*' });
				} else {
					socket.emit('subscribe_events', { event_type: eventType });
				}
			});

			socket.on('auth_invalid', (error) => {
				throw new NodeApiError(this.getNode(), {
					message: 'Authentication failed',
					description: error.message,
				});
			});

			socket.on('event', (message) => {
				if (message.event_type === eventType || eventType === '*') {
					const entityIds = entityId.split(',').map(id => id.trim());
					if (entityIds.length === 0 || entityIds.includes(message.data.entity_id)) {
						const output = includeEventData ? message : { entity_id: message.data.entity_id, state: message.data.new_state };
						this.emit([this.helpers.returnJsonArray(output)]);
					}
				}
			});

			// Warten auf erfolgreiche Verbindung
			await new Promise((resolve, reject) => {
				socket.on('auth_ok', resolve);
				socket.on('auth_invalid', reject);
				setTimeout(() => reject(new Error('Connection timeout')), 10000);
			});

		} catch (error) {
			closeFunction;
			if (error.name === 'NodeApiError') {
				throw error;
			} else {
				throw new NodeOperationError(this.getNode(), `Execution error: ${error.message}`);
			}
		}

		return {
			closeFunction,
		} as ITriggerResponse;
	}
}
