const EventEmitter = require('events');

class LiveEventEmitter extends EventEmitter {}

const liveEventEmitter = new LiveEventEmitter();

module.exports = liveEventEmitter;
