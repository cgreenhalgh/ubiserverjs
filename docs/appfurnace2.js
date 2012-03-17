// ubiserver2 code sample(s)

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
    connect('http://kubrick.mrl.nott.ac.uk:49891', id, name, group, group+'.public', undefined, onstatechange);
}

addScriptFile("content/socket.io.min.js", 
    function() {
        log('content/loaded socket.io: '+io);
        //io.Socket.prototype.isXDomain = function () { console.log('isXDomain'); return true; };
        //io.util.ua.hasCORS = false; 
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

