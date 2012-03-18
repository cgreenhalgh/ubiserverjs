// Here's where you should write your functions
function addScriptFile(src, callback) {
    var script = document.createElement("script");
    script.type = "text/javascript";
    script.onload = function() {
        callback(script);
    };
    script.src = src;
    window.document.body.appendChild(script);
}

var ubi = {};

// Here's where you should write your functions

function comparenumbers(a,b) { return b-a; }

var gpstime;
var bttime;

function updateAges() {
    var time = new Date().getTime();
    if (bttime!==undefined)
        ui.btage.text(Number((time-bttime)/1000).toFixed(0)+'s');
    if (gpstime!==undefined)
        ui.gpsage.text(Number((time-gpstime)/1000).toFixed(0)+'s');
    setTimeout(updateAges, 1000);
}
setTimeout(updateAges, 1000);

// common callback on channel value recevied from ubihelper
function onChannelValue(name, value) {
   var state = getsenderstate();
   var time = new Date().getTime();
    // check name and handle here...
    if (name=='bluetooth') {
        log('bluetooth '+JSON.stringify(value));
        //ui.btstatus.text(JSON.stringify(value));
         // { devices: [ {name:...,btaddress:...,...}], time: T}
        time = value.time;
        var scan = [];
        for (var di in value.devices) {
            var d = value.devices[di];
            scan.push(d.btaddress);
            //state.set('bt.'+d.btaddress,{name:d.name,time:time});            
        }
        state.set('btscan',{time:time,macs:scan});
        bttime = time;
        if (value.name!==undefined) {
            ui.btname.text(value.name);
        }
        if (value.btaddress!==undefined)
            ui.btaddr.text(value.btaddress);
        state.set('btinfo',{name:value.name,mac:value.btaddress});
        ui.btcount.text(value.devices.length);
    }
    else if (name=='gpsstatus') {
        var nsat = value.satellites.length;
        var snrs = [];
        for (var si in value.satellites) {
            var sat = value.satellites[si];
            snrs.push(sat.snr);
        }
        snrs.sort(comparenumbers);
        var gpsinfo = {time:time,nsat:nsat,snr1:snrs[0],snr4:snrs[3]};
        log('Gpsstatus: '+JSON.stringify(gpsinfo));
        ui.gpssnr.text(snrs[3]===undefined ? '-' : snrs[3]);
        state.set('gpsinfo',gpsinfo);
    }
    else if (name=='location.gps') {
        /* "timestamp":1332345421184,
        "provider":"gps",
        "lon":-1.1879963576391386,
        "time":1332431819160,
        "accuracy":35,
        "altitude":53,
        "lat":52.95323877913924 */
        var pos = {lat: value.lat, lon: value.lon, acc: value.accuracy, alt: value.altitude, time: time};
        log('gps: '+JSON.stringify(pos));
        state.set('pos',pos);
        gpstime = time;
        ui.gpsacc.text(Number(value.accuracy).toFixed(1));
    }
    else {
        log('ubihelper: '+name+' = '+JSON.stringify(value));
        // ...?
    }
}

//=========================================================================================
// Ubihelper configuration
// e.g. 4/second
var pollInterval = 0.25;
// e.g. bluetooth
var ubihelperQuery = '[{"name":"bluetooth","period":15},{"name":"gpsstatus","period":1},{"name":"location.gps","period":1}]';
// default
var ubihelperUrl = "http://127.0.0.1:8180/ubihelper";

//=========================================================================================
// Generic Ubihelper support  - shouldn't need changing
var count = 0;
function pollUbihelper() {
    count = count+1;
    ui.output.text(ui.output.text()+".");
    //  default URL
    try {
        $.ajax(
        {
            url:ubihelperUrl,
            type:"POST",
            data:ubihelperQuery,
            //dataType:'json',
            complete:function() {
                setTimeout(pollUbihelper, 1000*pollInterval);
            },
            error:function(xhr,status,error) {
                log('Error: '+status+' - '+error);            
                ui.output.text('Error: '+status+' - '+error);    
            },
            success:function(data,status,xhr) {
                for (var i in data) {
                    var el = data[i];
                    for (var vi in el.values) {
                        var val = el.values[vi];
                        onChannelValue(el.name, val);
                    }
                }
              ui.output.text('Got '+JSON.stringify(data));    
            }
        });
    } catch (err) {
        ui.output.text('Exception: '+err.message);
    }
}

// simulator?! - check phonegap device
var device = window.device;
if (device===undefined || device.platform===undefined) {
    // create window (if not closed won't reset, though)
    var my_window;
    my_window = window.open("", "ubihelper", "status=1,width=350,height=150");
    //my_window.close();
    
    log('try to open simulator window');
    my_window = window.open("", "ubihelper", "status=no,width=350,height=250,location=no,titlebar=no");
    my_window.document.write('<h1>Ubihelper sensor input</h1>');
    my_window.document.write('<script src="http://the.appfurnace.com/toolkit/shared/libs/jquery/jquery-1.6.1.js"></script>');
    my_window.document.write('<script src="https://raw.github.com/douglascrockford/JSON-js/master/json2.js"></script>');
    my_window.document.write('<p>Channel:</p>');
    my_window.document.write('<input type="text" id="name" value="accelerometer"/>');
    my_window.document.write('<p>Value:</p>');
    my_window.document.write('<input type="text" id="value""></input>');
    my_window.document.write('<script>function sendValue(name,value) { window.opener.onChannelValue(name,value); }</script>');
    my_window.document.write('<input type="button" value="Set" onClick="sendValue($(\'#name\').val(),JSON.parse($(\'#value\').val()))"/>');
    my_window.focus();
    
    // other code I might use at some point...
    //my_window.document.write('<div id="accelerometer_area" style="width:100px;height:100px;background-color:#ccc"></div>');
    //my_window.document.write('<script>$("#accelerometer_area").mousedown(function(event) { var x=event.pageX-this.offsetLeft; var y=event.pageY-this.offsetTop; var v={}; v.values=[20*(x-50)/50,20*(y-50)/50,0]; $(\'#accelerometer\').val(JSON.stringify(v));  sendValue("accelerometer",v); });</script>');
} else {
    log('platform'+'='+window.device.platform);
    setTimeout(pollUbihelper, 1000*pollInterval);
}


//=========================================================================================


function onstatechange(state) {
    log('Ubiserver state: '+state);
    ui.connstatus.text(state);
}

function init() {
    log('init...');
    ui.configokbutton.hidden(false);
}
function onConfig() {
    navigate.to('main');
    var id = 'appfurnace.'+ui.configdevicename.text()+'.'+(new Date().getTime());
    var group = ui.configgroupname.text();
    var name = ui.configdevicename.text();
    var transports;
    //if (device===undefined || device.platform===undefined)
        // simulator
    //    transports = ['jsonp-polling'];
    connect('http://kubrick.mrl.nott.ac.uk:49891', id, name, group, group+'.public', undefined, onstatechange, transports);
}

addScriptFile("content/socket.io.min.js", 
    function() {
        log('content/loaded socket.io: '+io);
        //io.Socket.prototype.isXDomain = function () { console.log('isXDomain'); return true; };
        //.util.ua.hasCORS = false; 
        addScriptFile("content/2.5.3-crypto-md5.js", 
            function() {
                log('content/loaded cryptojs');
                addScriptFile("content/ubistate.js", 
                    function(script) {
                        log('loaded ubistate: '+ubistate);
                        addScriptFile("content/client2.js", 
                            function() {
                                log('loaded client2');
                                init();
                            });
                    });
            });
        // loaded...
    });

