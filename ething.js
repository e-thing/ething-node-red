
var EventSource = require('eventsource');
var request = require('request');
var EThing = require("ething-js");



module.exports = function(RED) {

	
	function EThingControllerNode(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		
		node.log(JSON.stringify(config));
		
		// this controller node handles all communication with the configured ething server
		
		var state = {
			error: false,
			connected: false
		}
		
		EThing.config.serverUrl = 'http://' + config.host + ':' + String(config.port || 80);
		
		if(this.credentials.password){
			EThing.auth.setBasicAuth('ething', this.credentials.password);
		}
		
		this.ething = EThing;
		
		node.context().global.set("EThing",EThing);
		
		function setState(newstate){
			var updatedKeys = [];
			
			for(var key in newstate){
				if( !state.hasOwnProperty(key) || state[key] !== newstate[key] ){
					updatedKeys.push(key);
					state[key] = newstate[key];
				}
			}
			
			if(updatedKeys.length){
				
				node.log('state changed: '+JSON.stringify(state) );
				node.emit('stateChanged', state, updatedKeys);
			}
		}
		
		function getConnectionString(config) {
			var url = "http://";
			var password = node.credentials.password;
			
			if ( (password != undefined) && (password.length != 0) ) {
				url += "ething:" + password + "@";
			}
			
			url +=  config.host;
			
			if ( config.port != undefined )
			{
				var port = String(config.port).trim();
				if(port.length != 0)
					url += ":" + port;
			}
			
			return url;
		}
		
		function startEventServer() {
			
			if(node.es) return; // already running !
			
			url = getConnectionString(config) + "/api/events";
			
			node.log('starting events server at '+url );
			
			setState({error: false, connected: false})
			
			node.es= new EventSource(url, {});
			
			node.es.onopen = function(event) {
				setState({error: false, connected: true})
	       	};
			
	       	node.es.onmessage = function(msg) {
				
			    //node.log(msg.data);
				
				setState({error: false, connected: true})
				
				try {
        			// update the node status with the Item's new state
				    var event = JSON.parse(msg.data);
				    
				    node.emit("event", event);

				} catch(e) {
					// report an unexpected error
					node.warn("Event decoding error : " + e)
				}
				
			};
			
	       	node.es.onerror = function(err) {
				if( err.type && (JSON.stringify(err.type) === '{}') )
					return; // ignore
	       		
				setState({error: true})
				
	       		node.warn('Event source error : ' +	JSON.stringify(err));
				
				if ( err.status ) {
					if ( (err.status == 503) || (err.status == "503") || (err.status == 404) || (err.status == "404") )
						// the EventSource object has given up retrying ... retry reconnecting after 10 seconds
						
						node.es.close();
						delete node.es;
						
						setState({connected: false})

						setTimeout(function() {
							startEventServer();
						}, 5000);
						
				} else if ( err.type && err.type.code ) {
					// the EventSource object is retrying to reconnect
				} else {
					// no clue what the error situation is
				}
			  };

		}
		
		function stopEventServer(){
			if(node.es){
				node.log('stop event server');
				node.es.close();
				delete node.es;
				setState({error: false, connected: false});
			}
		}
		
		function updateEventServer(){
			if( node.listenerCount('event') ){
				// start the events server
				startEventServer();
			} else {
				// stop the events server
				stopEventServer();
			}
		}
		
		this.on("newListener", function(event, listener){
			if(event==="event") setTimeout(updateEventServer, 1);
		});
		
		this.on("removeListener", function(event, listener){
			if(event==="event") setTimeout(updateEventServer, 1);
		});
		
		this.on("close", function() {
			stopEventServer();
			node.removeAllListeners('event');
			node.removeAllListeners('stateChanged');
		});

	}
    RED.nodes.registerType("ething-controller", EThingControllerNode, {
		credentials: {
			password: {type:"password"}
		}
	});
	
	RED.httpAdmin.get('/ething/resources', function(req, res) {
		EThing.list().done(function(resources){
			res.json(resources.map(function(resource){
				return resource.json();
			}));
		});
    });
	
	
	function EThingEvents(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		var filter = null;
		
		if(config.filter){
			filter = config.filter.split(/[ ,;]/).map(function(n){return n.trim();}).filter(function(n){ return n !== '' });
			if(filter.length===0)
				filter = null;
		}
		
		var onevent = function(event) {
			if(filter && filter.indexOf(event.name)===-1) return;
            node.send({payload: event, event: event.name});
		};
		
		var onstatechanged = function(state){
			// update node status
			node.status({
				fill: state.connected ? ( state.error ? "red" : "green" ) : "grey" ,
				shape: 	"ring",
				text: state.error ? ("error: "+state.error) : ( state.connected ? "connected" : "disconnected" )
			});
		};
		
		controller.addListener('event', onevent);
		controller.addListener('stateChanged', onstatechanged);
		
		this.on("close", function() {
			controller.removeListener('event', onevent);
			controller.removeListener('stateChanged', onstatechanged);
		});

	}
	RED.nodes.registerType("ething-events", EThingEvents);
	
	
	function EThingResourceList(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var q = config.query || null;
			var anotherQuery = msg.payload;
			
			if(anotherQuery){
				if(q){
					// merge
					q = '('+q+') AND ('+anotherQuery+')';
				} else {
					q = anotherQuery;
				}
			}
			
			controller.ething.list(q).done(function(resources){
				node.send({payload:resources});
			}).fail(function(err){
				node.warn(String(err));
			});
			
		});
		
	}
	RED.nodes.registerType("ething-resource-list", EThingResourceList);
	
	
	function EThingResourceGet(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource || msg.payload;
			
			if(id){
				controller.ething.get(id).done(function(resource){
					node.send({payload:resource});
				}).fail(function(err){
					node.warn(String(err));
				});
			} else {
				node.warn('no given id');
			}
		});
		
	}
	RED.nodes.registerType("ething-resource-get", EThingResourceGet);
	
	
	
	
	function EThingDeviceExecute(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource;
			var operation = config.operation;
			var args = msg.payload;
			var binary = false;
			
			if(!id){
				// find the id in the payload
				if(msg.resource){
					if(typeof msg.resource === 'string')
						id = msg.resource;
					else
						id = msg.resource.id(); // must be a EThing.Resource instance !
				}
			}
			
			if(id){
				if(operation){
					controller.ething.Device.execute(id, operation, args, binary).done(function(result){
						node.send({
							payload:result,
							resource: msg.resource || id,
							args: args
						});
					}).fail(function(err){
						node.warn(String(err));
					});
				} else {
					node.warn('no given operation');
				}
			} else {
				node.warn('no given id');
			}
			
		});
		
	}
	RED.nodes.registerType("ething-device-execute", EThingDeviceExecute);
	
	
	function EThingFileRead(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource;
			var binary = config.binary;
			
			if(!id){
				// find the id in the payload
				var r = msg.resource || msg.payload;
				if(r){
					if(typeof r === 'string')
						id = r;
					else
						id = r.id(); // must be a EThing.Resource instance !
				}
			}
			
			if(id){
				controller.ething.File.read(id, binary).done(function(content){
					node.send({
						payload:content,
						resource: msg.resource || id
					});
				}).fail(function(err){
					node.warn(String(err));
				});
			} else {
				node.warn('no given id');
			}
			
		});
		
	}
	RED.nodes.registerType("ething-file-read", EThingFileRead);
	
	
	function EThingFileWrite(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource;
			var content = msg.payload;
			var append = config.append;
			
			if(!id){
				// find the id in the payload
				if(msg.resource){
					if(typeof msg.resource === 'string')
						id = msg.resource;
					else
						id = msg.resource.id(); // must be a EThing.Resource instance !
				}
			}
			
			if(id){
				controller.ething.File.write(id, content, append).done(function(resource){
					// do nothing
				}).fail(function(err){
					node.warn(String(err));
				});
			} else {
				node.warn('no given id');
			}
			
		});
		
	}
	RED.nodes.registerType("ething-file-write", EThingFileWrite);
	
	
	
	function EThingTableRead(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource;
			var options = {};
			
			if(typeof config.start === 'number')
				options.start = config.start;
			if(typeof config.length === 'number' && config.length !== 0)
				options.length = config.length;
			if(config.sort)
				options.sort = config.sort;
			if(config.query)
				options.query = config.query;
			
			if(!id){
				// find the id in the payload
				var r = msg.resource || msg.payload;
				if(r){
					if(typeof r === 'string')
						id = r;
					else
						id = r.id(); // must be a EThing.Resource instance !
				}
			}
			
			if(id){
				controller.ething.Table.select(id, options).done(function(content){
					node.send({
						payload:content,
						resource: msg.resource || id
					});
				}).fail(function(err){
					node.warn(String(err));
				});
			} else {
				node.warn('no given id');
			}
			
		});
		
	}
	RED.nodes.registerType("ething-table-read", EThingTableRead);
	
	
	function EThingTableInsert(config) {
		RED.nodes.createNode(this, config);
		var controller = RED.nodes.getNode(config.controller);
		var node = this;
		
		this.on("input", function(msg) {
			
			var id = config.resource;
			var data = msg.payload;
			
			if(!id){
				// find the id in the payload
				if(msg.resource){
					if(typeof msg.resource === 'string')
						id = msg.resource;
					else
						id = msg.resource.id(); // must be a EThing.Resource instance !
				}
			}
			
			if(id){
				controller.ething.Table.insert(id, data).done(function(resource){
					// do nothing
				}).fail(function(err){
					node.warn(String(err));
				});
			} else {
				node.warn('no given id');
			}
			
		});
		
	}
	RED.nodes.registerType("ething-table-insert", EThingTableInsert);

} 
