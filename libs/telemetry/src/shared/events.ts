/** Runtime and stream lifecycle event names accepted by the explicit Node capture client. */
export type ThreadplaneNodeEvent =
  | 'tplane:runtime_instance_created'
  | 'tplane:runtime_request_created'
  | 'tplane:stream_started'
  | 'tplane:stream_ended'
  | 'tplane:stream_errored';

/** Browser setup and chat initialization event names in the shared SDK event schema. */
export type ThreadplaneBrowserEvent =
  | 'tplane:browser_provided'
  | 'tplane:browser_chat_init';

/** All runtime and browser event names accepted by the shared SDK event validator. */
export type ThreadplaneEvent = ThreadplaneNodeEvent | ThreadplaneBrowserEvent;
