//https://socket.io/docs/client-api/
const io = require('socket.io-client');
const { vec } = require('../common/vector.js');
const { game } = require('../common/game.js');
const ADDRESS = 'http://192.168.1.204:3001';
// const ADDRESS = 'https://trussbucket.herokuapp.com/';
const socket = io(ADDRESS);
const { consts } = require('../common/constants.js');
var {
  mapRadius,
  playerRadius,
  hookRadius_outer,
  hookRadius_inner,
  chat_maxMessages: maxMessages,
  chat_maxMessageLen: maxMessageLen,
} = consts;


/** ---------- GAME CONSTANTS ----------
 */
var playerid = null;

var players = null;
var playersInfo = null;
var hooks = null;
var world = null;

// up, down, left, right
var keysPressedLocal = new Set();

/** ---------- SENDING TO SERVER ---------- 
 * (receiving is at very bottom) 
 * */
// returns a new function to execute and a promise that resolves when the new function executes
// returns [new_fn, promise]
const getWaitForExecutionPair = (callback) => {
  let r;
  const promise = new Promise((res, rej) => { r = res; });
  let new_fn = (...args) => {
    callback(...args);
    r();
  }
  return [new_fn, promise];
};

var send = {
  // sent when you join the game:
  join: async (callback) => {
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', 'user1', new_callback);
    await new_promise;
  },
  goindirection: (direction) => { // tells server that user just pressed a key (direction = "up|down|left|right")
    socket.emit('goindirection', direction);
  },
  stopindirection: (direction) => { // tells server that user just released a key (direction = "up|down|left|right")
    socket.emit('stopindirection', direction);
  },
  leftclick: (hookDir) => {
    socket.emit('leftclick', hookDir);
  },
  rightclick: () => {
    socket.emit('rightclick');
  },
  resethooks: () => {
    socket.emit('resethooks');
  },
  startaiming: () => {
    socket.emit('startaiming');
  },
  stopaiming: () => {
    socket.emit('stopaiming');
  },
  chatmessage: (msg) => {
    socket.emit('chatmessage', msg);
  },
}

/** ---------- CHAT ---------- */
var isChatting = false;
var chatMsg = "";


/** ---------- KEYBOARD (ALL LOCAL) ---------- */
var keyDirections = {
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}
var keyActions = {
  'r': "resethooks",
  'c': "resetzoom",
  'shift': "aiming",
  '/': "startchat",
  'enter': "sendchat",
  'escape': "cancel",
}



/** ---------- CANVAS / SCREEN CONSTANTS ---------- */
var canvas = document.getElementById("canvas");
const canv_top = canvas.getBoundingClientRect().top;
const canv_left = canvas.getBoundingClientRect().left;

var c = canvas.getContext("2d");

var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;
canvas.width = WIDTH;
canvas.height = HEIGHT;
var midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 }; //in world coords

let updateCanvasSize = () => {
  WIDTH = window.innerWidth;
  HEIGHT = window.innerHeight;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 };
}


/** ---------- DRAWING / CAMERA / GRAPHICS ---------- */
//1. update camZoom and camLoc
//2. call updateCamView()
//3. when drawing, use getPosOnScreen.
var camZoomDefault = 1.5;
var camZoom = camZoomDefault;
var camLoc = null; //camera location in world
var camZoomIsResetting = false;

const camZoomResetMult = 1 / 100; //percent (out of 1) per ms
const bgLineSpacing = 600;
const bgLineWidth = .5;
const bgLineWidthBold = .7;
const bgNumDivisions = 8;
const bgMaxLines = bgNumDivisions; //max num bold lines you see on a screen

//log_n(m)
const logn = (n, m) => {
  return Math.log(m) / Math.log(n);
}

const positiveMod = (n, m) => {
  if (n < 0) return ((n % m) + m) % m;
  else return n % m;
}

var getPosOnScreen = (locInWorld) => {
  let camToObj = vec.sub(locInWorld, camLoc);
  let screenPos = vec.normalized(camToObj, vec.magnitude(camToObj) / camZoom);
  let posWithNegY = vec.add(screenPos, midScreen);
  return { x: posWithNegY.x, y: -posWithNegY.y };
}

// make sure start is the intersection to start bolding!! start, end, inc are all in corrds of screen
//inclusive of both start and end unless excludeStart==true, then exclude start
// if x=true then draw all appropriate vertical lines using x coord, else horiz w/ y coord
const drawVerticalLine = (x, lineWidth) => {
  c.beginPath();
  c.strokeStyle = 'hsla(0,0%,30%,.3)';
  c.lineWidth = lineWidth;
  c.moveTo(x, 0);
  c.lineTo(x, HEIGHT);
  c.stroke();
};
const drawHorizontalLine = (y, lineWidth) => {
  c.beginPath();
  c.strokeStyle = 'hsla(0,0%,30%,.3)';
  c.lineWidth = lineWidth;
  c.moveTo(0, y);
  c.lineTo(WIDTH, y);
  c.stroke();
};
var drawBGLinesAlongCoord = (isX, start, end, inc, excludeStart) => {
  let count = 0;
  if (excludeStart) {
    count++;
    start += inc;
  }
  let fn = isX ? drawVerticalLine : drawHorizontalLine;
  for (let coord = start; inc > 0 ? coord <= end : coord >= end; coord += inc) {
    let lineWidth = count % bgNumDivisions === 0 ? bgLineWidthBold : bgLineWidth;
    fn(coord, lineWidth);
    count++;
  }
}


var playerCamera = {
  update: (newCamLoc, dt) => {
    camLoc = newCamLoc;
    if (camZoomIsResetting) {
      if (camZoom > camZoomDefault) { //zoom too big
        camZoom -= camZoom * camZoomResetMult * dt;
        if (camZoom <= camZoomDefault) {
          camZoom = camZoomDefault;
          camZoomIsResetting = false;
        }
      } else { //zoom too small
        camZoom += camZoom * camZoomResetMult * dt;
        if (camZoom >= camZoomDefault) {
          camZoom = camZoomDefault;
          camZoomIsResetting = false;
        }
      }
    }
  },
  drawBG: () => {
    //draw every other nth line, where n = add, bolding every bgNumDivisions_th line
    let add = Math.pow(bgNumDivisions, Math.ceil(logn(bgNumDivisions, Math.ceil(Math.max(WIDTH, HEIGHT) * camZoom / bgLineSpacing) / bgMaxLines)));
    //gets camera location's bottom location mod spacing * numDivisions (add this to camera to get aligned spacing; numDivisions so can just count to bolden every bgNumDivision)
    let camLocModSpacing = vec.apply(camLoc, positiveMod, add * bgLineSpacing);
    let intersectionModLoc = getPosOnScreen(vec.sub(camLoc, camLocModSpacing));

    let inc = add * bgLineSpacing / (camZoom * bgNumDivisions);
    drawBGLinesAlongCoord(true, intersectionModLoc.x, WIDTH, inc, false);
    drawBGLinesAlongCoord(true, intersectionModLoc.x, 0, -inc, true);
    drawBGLinesAlongCoord(false, intersectionModLoc.y, HEIGHT, inc, false);
    drawBGLinesAlongCoord(false, intersectionModLoc.y, 0, -inc, true);
  },
  drawWorldBorder: () => {
    c.beginPath();
    c.lineWidth = 20 / camZoom;
    c.strokeStyle = 'green';
    let pos = getPosOnScreen({ x: 0, y: 0 });
    c.arc(pos.x, pos.y, mapRadius / camZoom + c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();
  },

  drawPlayer: (pid) => {
    let color = players[pid].color;
    let loc = getPosOnScreen(players[pid].loc);

    c.beginPath();
    c.lineWidth = 6 / camZoom;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, playerRadius / camZoom - c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();


    //draw chat messages:
    let n = 1;
    if (pid === socket.id && isChatting) {
      let msg = chatMsg || "|";
      c.font = (20 / camZoom) + "px Verdana";
      c.textAlign = "center";
      c.textBaseline = "top";
      //inside
      c.fillStyle = color;
      c.fillText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      //outline
      c.strokeStyle = 'black';
      c.lineWidth = .1 / camZoom;
      c.strokeText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      n++;
    }
    for (let i = players[pid].messages.length - 1; i >= 0; i--) {
      let msg = players[pid].messages[i];
      c.font = (30 / camZoom) + "px Verdana";
      c.textAlign = "center";
      c.textBaseline = "top";
      //inside
      c.fillStyle = color;
      c.fillText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      //bold
      c.strokeStyle = 'black';
      c.lineWidth = .1 / camZoom;
      c.strokeText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      n++;
    }

  },

  drawHook: (hid, pid_from) => {
    let ploc = getPosOnScreen(players[pid_from].loc);
    let hloc = getPosOnScreen(hooks[hid].loc);
    let [hcol, linecol, bobbercol] = hooks[hid].colors;
    let outer_lw = 2 / camZoom;
    let inner_lw = 2 / camZoom;
    // draw the line
    c.beginPath();
    c.lineWidth = 1 / camZoom;
    c.strokeStyle = linecol;
    c.moveTo(ploc.x, ploc.y);
    c.lineTo(hloc.x, hloc.y);
    c.stroke();

    // draw the hook
    // inside hook (square)
    c.beginPath();
    c.strokeStyle = hcol;
    c.lineWidth = inner_lw;
    let hRad_inner = hookRadius_inner / camZoom;
    c.rect(hloc.x - hRad_inner + inner_lw / 2, hloc.y - hRad_inner + inner_lw / 2, 2 * hRad_inner - inner_lw, 2 * hRad_inner - inner_lw);
    c.stroke();

    // outside bobber (circle)
    c.beginPath();
    c.lineWidth = outer_lw;
    c.strokeStyle = bobbercol;
    let hRad_outer = hookRadius_outer / camZoom;
    c.arc(hloc.x, hloc.y, hRad_outer + outer_lw / 2, 0, 2 * Math.PI);
    c.stroke();
  },

  drawHole: (hlid) => {
    let color = world.holes[hlid].color;
    let loc = getPosOnScreen(world.holes[hlid].loc);
    let radius = world.holes[hlid].radius / camZoom;

    c.beginPath();
    c.lineWidth = radius;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, radius - c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();
  },
}


/** ---------- FUNCTION CALLED EVERY FRAME TO DRAW/CALCULATE ----------  
 * Run the game as if you're the server (but obviously without constant updates. No creating/deleting.)
*/

var prevtime;
var starttime;
var currtime;
let newFrame = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  currtime = timestamp - starttime;
  prevtime = timestamp;

  // UPDATE GAME AS IF SERVER
  game.update(dt);

  // calculate fps
  let fps = Math.round(1000 / dt);
  // console.log("fps: ", fps);

  //update camera:
  playerCamera.update(players[socket.id].loc, dt);

  //render:
  c.clearRect(0, 0, WIDTH, HEIGHT);

  //draw BG:
  playerCamera.drawBG();

  //draw holes:
  for (let hlid in world.holes) {
    playerCamera.drawHole(hlid);
  }

  //draw border:
  playerCamera.drawWorldBorder();

  //draw others:
  for (let pid in players) {
    if (pid === socket.id) continue;
    playerCamera.drawPlayer(pid);
  }
  //draw me last
  playerCamera.drawPlayer(socket.id);

  // draw hooks
  for (let hid in hooks) {
    playerCamera.drawHook(hid, hooks[hid].from);
  }


  window.requestAnimationFrame(newFrame);
}


/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  if (keysPressedLocal.has(key)) return;
  keysPressedLocal.add(key);
  // console.log('pressing', key);

  if (isChatting && key.length === 1) {
    if (chatMsg.length < maxMessageLen) {
      chatMsg += event.key;
    }
  }
  else if (isChatting && key == "backspace") {
    chatMsg = chatMsg.substr(0, chatMsg.length - 1);
  }

  else if (keyDirections[key]) { //ie WASD was pressed, not some other key
    let movementDir = keyDirections[key];
    send.goindirection(movementDir);

  } else if (keyActions[key]) {
    let actionKey = keyActions[key];
    switch (actionKey) {
      case "resethooks":
        send.resethooks();
        break;
      case "resetzoom":
        camZoomIsResetting = true;
        break;
      case "aiming":
        send.startaiming();
        break;

      // chat:
      case "startchat":
        isChatting = true;
        chatMsg = "";
        break;
      case "sendchat":
        if (isChatting) {
          chatMsg = chatMsg.trim();
          if (chatMsg) send.chatmessage(chatMsg);
          isChatting = false;
          chatMsg = "";
        }
        break;
      case "cancel":
        if (isChatting) {
          isChatting = false;
          chatMsg = "";
        }
        break;
    }

  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  if (!keysPressedLocal.has(key)) return;
  keysPressedLocal.delete(key);

  // console.log('releasing', key);

  if (keyDirections[key]) {
    let movementDir = keyDirections[key];
    send.stopindirection(movementDir);

  } else if (keyActions[key]) {
    let actionKey = keyActions[key];
    switch (actionKey) {
      case "aiming":
        send.stopaiming();
        break;
    }

  }
});


document.addEventListener('mousedown', function (event) {
  switch (event.button) {
    //left click:
    case 0:
      let mousePos = { x: event.clientX - canv_left, y: -(event.clientY - canv_top) };
      let hookDir = vec.sub(mousePos, midScreen); //points from player to mouse
      send.leftclick(hookDir);
      break;
    //right click
    case 2:
      send.rightclick();
      break;

  }
});

const zoomMin = 1 / 100;
const zoomMax = 100;
const dYPercent = 1 / 1000;
document.addEventListener('wheel', event => {
  if (camZoomIsResetting) return;
  let dZoom = 1 + (event.deltaY * dYPercent);
  let newZoom = camZoom * dZoom;
  if (newZoom < zoomMin) {
    camZoom = zoomMin;
  } else if (newZoom > zoomMax) {
    camZoom = zoomMax;
  } else {
    camZoom *= dZoom;
  }
});

//anti right-click and middle click
document.addEventListener('contextmenu', event => event.preventDefault());
document.onmousedown = function (e) { if (e.button === 1) return false; }

window.addEventListener('resize', () => {
  updateCanvasSize();
});


const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (serverPlayers, serverPlayersInfo, serverHooks, serverWorld) => {
    playerid = socket.id;
    game.set(serverPlayers, serverPlayersInfo, serverHooks, serverWorld, true);
    players = serverPlayers;
    playersInfo = serverPlayersInfo;
    hooks = serverHooks;
    world = serverWorld;
  };
  await send.join(joinCallback);

  console.log("playerid", playerid);
  console.log("players", players);
  console.log("playersInfo", playersInfo);
  console.log("hooks", hooks);
  console.log("world", world);

  // once get here, know that everything is defined, so can start rendering  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const serverImage = (serverPlayers, serverPlayersInfo, serverHooks) => {
  if (!players) console.log("too early");
  game.set(serverPlayers, serverPlayersInfo, serverHooks, world, true);
  players = serverPlayers;
  playersInfo = serverPlayersInfo;
  hooks = serverHooks;
}
socket.on('serverimage', serverImage);


socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
