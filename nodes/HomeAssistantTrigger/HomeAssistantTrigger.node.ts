import {
    INodeType,
    INodeTypeDescription,
    IDataObject,
    ITriggerFunctions,
    ITriggerResponse,
		NodeApiError,
    ICredentialDataDecryptedObject,
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
        outputs: ['main'],
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
        //const credentials = this.getCredentials('homeAssistantApi');

        const credentials = await this.getCredentials('homeAssistantApi') as ICredentialDataDecryptedObject;
        
		try {
			if (!credentials) {
				throw new Error('No credentials returned!');
			}

			const socket: Socket = io(wsUrl, {
				auth: {
					token: credentials.authToken as string,
				},
				autoConnect: false,
			});
			
			socket.connect();

			socket.on('connect', () => {
				console.log('Connected to Home Assistant WebSocket');
				socket.emit('auth', { access_token: credentials.authToken });
			});
			
			// Handle connection errors
			socket.on('connect_error', (error) => {
				const errorData = {
						message: 'WebSocket connection error',
						description: error.message,
				};
				throw new NodeApiError(this.getNode(), errorData);
			});

			socket.on('auth_ok', () => {
				console.log('Authentication successful');
				console.log(`Subscribing to ${eventType}...`);

				if (eventType === 'subscribe_trigger') {
					const entityIds = entityId.split(',');
					const triggerCondition: IDataObject = {
						platform: 'state',
					};
					if (fromState) {
						triggerCondition.from = fromState.split(',');
					}
					if (toState) {
						triggerCondition.to = toState.split(',');
					}
					for (const id of entityIds) {
						console.log(`entityId: ${id}`);
						triggerCondition.entity_id = id;
						console.log(`triggerCondition: ${JSON.stringify(triggerCondition)}`);
						socket.emit('subscribe_trigger', {
							type: eventType,
							trigger: triggerCondition,
						});
					}
				} else if (eventType === '*') {
					console.log('Subscribing to all events');
					socket.emit('subscribe_events', { event_type: '*' });
				} else {
					socket.emit('subscribe_events', { event_type: eventType });
				}
			});

			socket.on('auth_invalid', (error) => {
				console.error('Authentication failed:', error);
				socket.close();
				
				const errorData = {
						message: 'WebSocket connection error',
						description: error.message,
				};
				throw new NodeApiError(this.getNode(), errorData);
			});

			socket.on('event', (message) => {
				if (message.event_type === eventType || eventType === '*') {
					if (entityId && message.data.entity_id !== entityId) {
						return;
					}
					const output = includeEventData ? message : { entity_id: message.data.entity_id, state: message.data.new_state };
					this.emit([this.helpers.returnJsonArray(output)]);
				}
			});


			async function closeFunction() {
				socket.close();
			}
		} catch (error){
			if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message }, pairedItem: itemIndex });
			} else {
				if (error.name === 'NodeApiError') {
					throw error;
				} else {
					throw new NodeOperationError(this.getNode(), `Execution error: ${error.message}`, { itemIndex });
				}
			}
		}

        return {
            closeFunction,
        };
    }
}
