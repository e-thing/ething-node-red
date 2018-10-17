// import something here
var EThing = require("ething-js");
var EventSource = require('eventsource');


// SSE

var _events_handlers = {}

const CLOSED = 0
const OPENING = 1
const OPEN = 2

module.exports = {
	source: null,

	CLOSED,
	OPENING,
	OPEN,

	state: CLOSED,

	autoreconnect: true,

	on (event, handler) {
		if (!_events_handlers[event]) {
			_events_handlers[event] = []
		}
		_events_handlers[event].push({
			handler
		})
	},

	off (event, handler) {
		if (_events_handlers[event]) {
			if (handler) {
				_events_handlers[event] = _events_handlers[event].filter(item => item.handler !== handler)
			} else {
				// remove all handler
				_events_handlers[event] = []
			}
		}
	},

	emit (event, args) {
		if (_events_handlers[event]) {
			_events_handlers[event].forEach(item => {
				item.handler(args)
			})
		}
	},

	start () {
		var self = this

		this.state = OPENING

		console.log('[SSE] connecting...')

		var source = this.source = new EventSource(EThing.config.serverUrl + "/api/events", { withCredentials: true, https: {rejectUnauthorized: false} })

		source.onopen = function() {
			console.log("[SSE] connected")
			self.state = OPEN

			self.emit('connected')
		}

		source.onerror = function() {
			if (self.state !== CLOSED) {
				console.warn("[SSE] disconnected")
				self.stop()

				self.emit('disconnected')

				if (self.autoreconnect) {
					setTimeout(() => {
						if (self.state === CLOSED) {
							console.log("[SSE] reconnecting...")
							self.start()
						}
					}, 5000)
				}
			}
		}

		source.onmessage = (event) => {
			var data = JSON.parse(event.data)
			self.emit('message', event)
		}


	},

	stop () {
		this.state = CLOSED
		if(this.source){
			console.log('[SSE] stop')
      this.source.close()
		}
	},

};
