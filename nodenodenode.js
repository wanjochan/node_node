/*
 * require('nodenodenode')() fwd req to appModule
 *        server_host/server_port => http server
 *    or  http_host/http_port     => http server
 *         https_host/https_port  => https server
 *         ws_host/ws_port        => web-socket server
 *                   + ws_secure  => wss
 */

const util = require('util');

var debug=0;//debug level

var logger=console;//default logger

function isEmpty(o,i){for(i in o){return!1}return!0}

function copy_o2o(o1,o2){for(var k in o2){o1[k]=o2[k]}return o1}

//function argv2o(argv,m,mm){var rt={};for(k in argv)(m=(rt[""+k]=argv[k]).match(/^(\/|--?)([a-zA-Z0-9-_]*)="?(.*)"?$/))&&(rt[m[2]]=m[3]);return rt}
const argv2o=o=>o.reduce((r,e)=>(m=e.match(/^(\/|--?)([a-zA-Z0-9-_]*)="?(.*)"?$/))&&(r[m[2]]=m[3])&&r||r,{});

var argo={};

var flag_daemon=false;

module.exports = this_argo => {

	var rt={STS:'OK'};

	//command line parameters override
	copy_o2o(argo,argv2o(process.argv));

	//special patch for NWJS
	if (process.versions.nw) {
		//safe check
		if('undefined'==typeof nw){
			logger.log({process_version:process.versions});
			throw new Error('nw is undefined while process.versions.nw?');
		}
		//nwjs command line parameters override
		copy_o2o(argo,argv2o(nw.App.argv));
		//
		rt.is_nwjs=true;
		//tune logger
		logger={log:function(){
			try{console.log(util.format.apply(null, arguments))}catch(ex){
				console.log.apply(console,arguments);}
		}};
	}

	//caller override
	if(!isEmpty(this_argo)) copy_o2o(argo,this_argo);

	if(argo.debug) debug=argo.debug;

	//.has_global
	if(typeof(global)!='undefined') rt.has_global=has_global=true; 

	//for uv_queue_work()
	process.env.UV_THREADPOOL_SIZE = argo.UV_THREADPOOL_SIZE || 126;

	//app module
	if(!argo.app){
		if(!argo.approot){//must specify the approot for default egapp
			rt.approot=argo.approot=process.cwd();
		}
		rt.app=argo.app=__dirname + '/egapp.js';//load the default egapp ...
	}

	//hook the the app module to the rt
	var appModule=rt.appModule=require(argo.app)({argo});

	////////////////////////////////////////////////////////// HTTP
	var http_host=argo.server_host||argo.http_host||argo.h||'localhost',http_port=argo.server_port||argo.http_port||argo.p;
	if(http_port){
		if(!appModule.handleHttp) throw new Exception('appModule.handleHttp is not defined.');
		//rt.http_server=require('http').createServer( appModule.handleHttp );
		rt.http_server=require('http').createServer( (req,res)=>{ res.setHeader('Access-Control-Allow-Origin','*');return appModule.handleHttp(req,res) });
		try{
			rt.http_server.listen(http_port,http_host,()=>{logger.log('http listen on ',http_host,':',http_port)});
			rt.flag_http=true;
			flag_daemon=true;
		}catch(ex){
			if(debug>0){
				logger.log('failed to start http_server on '+http_host+':'+http_port);
				logger.log(ex);
			}
		}
	}

	////////////////////////////////////////////////////////// HTTPS
	var https_host=argo.https_host||'localhost',https_port=argo.https_port;
	if(https_port){
		if(!appModule.handleHttps) throw new Exception('appModule.handleHttps is not defined.');
		var {https_key,https_cert}=argo.https_key;
		rt.https_server=require('https').createServer({
			key: fs.readFileSync(https_key),
			cert: fs.readFileSync(https_cert)
		},appModule.handleHttps);
		try{
			rt.https_server.listen(https_host,https_host,()=>{logger.log('https listen on ',https_host,':',https_port)});
			flag_daemon=true;
			rt.flag_https=true;
		}catch(ex){
			if(debug>0){
				logger.log('failed to start https_server on '+https_host+':'+https_port);
				logger.log(ex);
			}
		}
	}

	////////////////////////////////////////////////////////// WEBSOCKET
	var ws_port=argo.ws_port,ws_host=argo.ws_host||'localhost';
	if(ws_port){
		var _client_conn_a={};//pool
		try{
			var ws = require("nodejs-websocket");
			if(!ws){
				throw new Error("nodejs-websocket module needed for .ws_port/.ws_host");
			}
			if(ws_port>1024){
			}else{
				if(debug>1){
					logger.log("WARNING port < 1024");
				}
			}
			if(debug>1){
				logger.log("pid=",process.pid);
			}
			ws.setMaxBufferLength(20971520);
			var ws_opts={};
			if (argo.ws_secure) ws_opts.secure=true;
			var ws_server = rt.ws_server = ws.createServer(ws_opts);
			ws_server.on('connection',function(conn){
				var _addr=(conn.socket.remoteAddress);
				var _port=(conn.socket.remotePort);
				var _key=""+_addr+":"+_port;
				if(debug>1){
					logger.log("on conn "+_key);
				}
				conn.key=_key;
				conn.lmt=(new Date()).getTime();
				_client_conn_a[_key]=conn;
				conn.on("error", function (e){
					if(debug>0){
						logger.log("ws_server.conn.error",e);
					}
				});
				conn.on("text", function (data_s){
					if(debug>1){
						logger.log("on text",data_s);
					}
					if(!appModule.handleWebSocket) throw new Exception('appModule.handleWebSocket is not defined.');
					appModule.handleWebSocket(data_s,conn);
				});
				conn.on("close", function (code, reason){
					if(debug>1){
						logger.log("ws_server.close="+code+","+reason,"key="+ws_server.key);
					}
					_client_conn_a[_key]=null;
					delete _client_conn_a[_key];
				});
			});
			ws_server.on('error', function(e){
				if(debug>0){
					logger.log("ws_server.error",e);
				}
				if (e.code == 'EADDRINUSE'){
					throw new Error('Address in use',{ws_port,ws_host});
				}
			});
			if(debug>1){
				logger.log("ws listen on "+ws_port);
			}
			try{
				ws_server.listen(ws_port);
				flag_daemon=true;
				rt.flag_ws=rt.flag_websocket=true;
			}catch(ex){
				if(debug>0){
					logger.log('failed to start ws_server on '+ws_host+':'+ws_port);
					logger.log(''+ex);
				}
			}
		}catch(ex){
			if(debug>0){
				logger.log("ws.ex=",ex);
			}
		}
	}

	////////////////////////////////////////////////////////// IPC
	var ipc_path=argo.ipc_path;
	if(ipc_path){
		if(!appModule.handleIPC) throw new Exception('appModule.handleIPC is not defined.');

		if (process.platform ==='win32'){
			ipc_path = ipc_path.replace(/^\//, '');
			ipc_path = ipc_path.replace(/\//g, '-');
			ipc_path = `\\\\.\\pipe\\${ipc_path}`;
		}
		
		rt.ipc_server=require('net').createServer(appModule.handleIPC);//handleIPC: conn=>{}
		try{
			rt.ipc_server.listen(ipc_path,()=>{logger.log('net listen on '+ipc_path)});
			rt.flag_ipc=true;
			flag_daemon=true;
		}catch(ex){
			if(debug>0){
				logger.log('failed to start ipc_server on '+ipc_path);
				logger.log(ex);
			}
		}
	}

	////////////////////////////////////////////////////////// TCP
	var tcp_path=argo.tcp_path;
	if(tcp_path){
		if(!appModule.handleTCP) throw new Exception('appModule.handleTCP is not defined.');

		rt.tcp_server=require('net').createServer(appModule.handleTCP);//handleIPC: conn=>{}
		try{
			rt.tcp_server.listen(tcp_path,()=>{logger.log('net listen on '+tcp_path)});
			rt.flag_tcp=true;
			flag_daemon=true;
		}catch(ex){
			if(debug>0){
				logger.log('failed to start tcp_server on '+tcp_path);
				logger.log(ex);
			}
		}
	}

	////////////////////////////////////////////////////////// UDP TODO (https://nodejs.org/api/dgram.html) => handleUDP

	////////////////////////////////////////////////////////// rt
	rt.flag_daemon=flag_daemon;
	return rt;
};
