//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3001';
const socket = io(ADDRESS);

/** ---------- VECTOR FUNCTIONS ---------- */
//vector functions on {x: , y:}:
var vec = {
  // add vector a and b
  add: (...vecs) => {
    let x = 0, y = 0;
    for (let v of vecs) {
      x += v.x;
      y += v.y;
    }
    return { x: x, y: y };
  },

  // s*v, a is scalar, v is vector
  scalar: (v, s) => {
    return { x: s * v.x, y: s * v.y };
  },

  // the magnitude of the vector
  mag: (a) => {
    return Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
  },

  // neither vector is null, and they have same values
  equals: (a, b) => {
    return !!a && !!b && a.x == b.x && a.y == b.y;
  },

  // vector is not null, and doesnt contain all falsy values (including 0)
  nonzero: (a) => {
    return !!a && (!!a.x || !!a.y);
  },

  // if unnormalizable, return the 0 vector. 
  // Normalizes to a vector of size mag, or 1 if undefined
  normalized: (a, mag) => {
    if (!mag) {
      if (mag !== 0) mag = 1;
      else return { x: 0, y: 0 };
    }
    let norm = vec.mag(a);
    return norm == 0 ? { x: 0, y: 0 } : vec.scalar(a, mag / norm);
  },

  negative: (a) => {
    return vec.scalar(a, -1);
  },

  dot: (a, b) => {
    return a.x * b.x + a.y * b.y;
  }
}


/** ---------- GAME CONSTANTS ----------
 * these are initialized by server after player joins
 */
var localPlayer = null;
var world = null;
var players = null;
//players does not include yourself
// 1. send 'join' event to server, server gives you players, world, localPlayer
// 2. on player join, add that new player to players
// once initialized, 
//players = {
//  otherplayer.socket.id: {
//  loc: {x:0, y:0},
//  vel: {x:0, y:0}, //velocity. Note vel.y is UP, not down (unlike how it's drawn)
//  username: user1,
//  hooks: {loc: hookloc, vel: hookvel, hookedPlayer: player}
//  isHooked: false // make your base walkspeed slower if true
//  }, 
//  }, 
//  }, 
//}
var playerRadius = null;
var walkspeed = null; // pix/ms
var hookRadius = null; //circle radius (the inner square hook is decoration)
var hookspeed = null;



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


var sent = {
  vel: null,

}

var send = {
  // sent when you join the game:
  join: async (callback) => {
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', 'user1', new_callback);
    await new_promise;
  },
  // sent to update your location to the server:
  updateloc: () => { // sends loc & vel
    // const buf2 = Buffer.from('bytes');
    socket.emit('updateloc', localPlayer.loc, localPlayer.vel);
  },
}



/** ---------- KEYBOARD (ALL LOCAL) ---------- */
var keyBindings = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd'
}

var keyDirections = {
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}

//returns true iff key 1 is parallel and in the opposite direction to key 2 
var keyDirection_isOpposite = (key1, key2) => {
  let [d1, d2] = [keyDirections[key1], keyDirections[key2]];
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

// assumes these are normalized
var keyVectors = {
  'w': { x: 0, y: 1 },
  's': { x: 0, y: -1 }, //must = -up
  'a': { x: -1, y: 0 }, //must = -right
  'd': { x: 1, y: 0 }
}

// contains 'w', 'a', 's', or 'd' (movement keys, not something like 'p' unless keybindings are changed)
var keysPressed = new Set();

// if k is null, there is no orthogonal key to a and b being pressed, or there are 2
// if k is not, it's the single key pressed that's orthogonal to key k
var keysPressed_singleOrthogonalTo = (k) => {
  let ret = null;
  switch (keyDirections[k]) {
    case "left":
    case "right":
      if (keysPressed.has(keyBindings["up"])) ret = keyBindings["up"];
      if (keysPressed.has(keyBindings["down"])) {
        if (ret) ret = null;
        else {
          ret = keyBindings["down"];
        }
      }
      break;
    case "up":
    case "down":
      if (keysPressed.has(keyBindings["left"])) ret = keyBindings["left"];
      if (keysPressed.has(keyBindings["right"])) {
        if (ret) ret = null;
        else {
          ret = keyBindings["right"];
        }
      }
      break;
  }
  return ret;
}

var directionPressed = { x: 0, y: 0 } //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)

/** ---------- NON-LOCAL BOOSTING VARIABLES ---------- */
var boostDir = null; // direction of the boost (null iff no boost)
var boostMultiplier = 0; // magnitude of boost in units of walkspeeds

/** ---------- BOOSTING (LOCAL VARS / FUNCTIONS) ---------- */
var boostKey = null; // key that needs to be held down for current boost to be active

// Record the previous 2 keys pressed
var recentKeys = []; //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
var recentKeysRepeat = false;
var recentKeys_insert = (key) => {
  if (key === recentKeys[1]) { //repeat
    recentKeysRepeat = true;
  } else { // no repeat
    recentKeysRepeat = false;
    recentKeys[0] = recentKeys[1];
    recentKeys[1] = key;
  }
}
// stops player from being able to continue / initiate boost (they have to redo as if standing still with no keys pressed yet)
var boostReset = () => {
  boostMultiplier = 0;
  boostDir = null;
  boostKey = null;
  recentKeys = [];
  recentKeysRepeat = false;
}
// creates a boost in direction of key k, with boostMultipler increased by inc
var boostSet = (k, inc) => {
  boostMultiplier += inc;
  if (boostMultiplier <= 0) boostReset();
  else {
    boostDir = keyVectors[k];
    boostKey = k;
  }
}


// Can assume that the last entry in recentKeys is not null, since 
// which is true since this is called after a WASD key is pressed
// updates boostDir and boostKey
var boost_updateOnPress = (key) => {
  recentKeys_insert(key);

  let a = recentKeys[0];
  let b = recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  let c = keysPressed_singleOrthogonalTo(b);  // c is the key of the BOOST DIRECTION!!! (or null if no boost)

  // have no boost yet, so initialize
  if (!boostDir) {
    // starting boost: no boost yet, so initialize 
    // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
    if (keyDirection_isOpposite(a, b) && c) {
      boostSet(c, .6);
    }
  }
  // currently have boost, continue it or lose it
  else {
    if (c === boostKey && !recentKeysRepeat && keyDirection_isOpposite(a, b)) {
      boostSet(c, .6);
    }
    else if (c === boostKey && recentKeysRepeat) {
      boostSet(c, -.1);
    }
    else if (c && keyDirection_isOpposite(b, boostKey)) {
      boostSet(c, 0);
    }
    else {
      boostReset();
    }
  }

}

var boost_updateOnRelease = (keyReleased) => {
  if (boostKey) { // W and A/D boost
    if (keysPressed.size === 0
      || (keyReleased === boostKey && keysPressed.size !== 1)) { //reset boost

      boostReset();
    }
  }
}




/** ---------- DRAWING / GRAPHICS ---------- */
function graphics_brightenColor(col, amt) {
  var usePound = false;
  if (col[0] == "#") {
    col = col.slice(1);
    usePound = true;
  }
  var num = parseInt(col, 16);
  var r = (num >> 16) + amt;
  if (r > 255) r = 255;
  else if (r < 0) r = 0;
  var b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255;
  else if (b < 0) b = 0;
  var g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255;
  else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);
}


var drawPlayer = (color, loc) => {
  c.beginPath();
  c.lineWidth = 6;//isLocalPlayer ? 4 : 2;
  c.strokeStyle = color;
  c.arc(loc.x, -loc.y, playerRadius - c.lineWidth / 2, 0, 2 * Math.PI);
  c.stroke();

  // c.font = "10px Verdana";
  // c.textAlign = "center";
  // c.textBaseline = "top";
  // c.fillStyle = color;
  // c.fillText(username, loc.x, loc.y + playerRadius + 5);

}

var drawHook = (pcolor, ploc, hloc) => {
  let outer_lw = 2;
  let inner_lw = 2;
  let hookRadius_inner = .7 * (hookRadius / Math.sqrt(2)); //square radius (not along diagonal)
  // draw the line
  c.beginPath();
  c.lineWidth = 1;
  c.strokeStyle = graphics_brightenColor(pcolor, 30);
  c.moveTo(ploc.x, -ploc.y);
  c.lineTo(hloc.x, -hloc.y);
  c.stroke();

  // draw the hook
  // inside bobber (square)
  c.beginPath();
  c.strokeStyle = graphics_brightenColor(pcolor, -20);
  c.lineWidth = inner_lw;
  c.rect(hloc.x - hookRadius_inner + inner_lw / 2, -(hloc.y - hookRadius_inner + inner_lw / 2), 2 * hookRadius_inner - inner_lw, -(2 * hookRadius_inner - inner_lw));
  c.stroke();

  // outside container (circle)
  c.beginPath();
  c.lineWidth = outer_lw;
  c.strokeStyle = graphics_brightenColor(pcolor, -50);
  c.arc(hloc.x, -hloc.y, hookRadius + outer_lw / 2, 0, 2 * Math.PI);
  c.stroke();
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

var prevtime;
var starttime;
var currtime;

/** ---------- FUNCTION CALLED EVERY FRAME TO DRAW/CALCULATE ---------- */
let newFrame = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  currtime = timestamp - starttime;
  prevtime = timestamp;

  // calculate fps
  let fps = Math.round(1000 / dt);
  // console.log("fps: ", fps);

  //Multiplier decay
  boostMultiplier -= dt * (a * Math.pow(boostMultiplier, 2) + b);
  if (boostMultiplier < 0) boostMultiplier = 0;
  else if (boostMultiplier > 2.5) boostMultiplier = 2.5;
  
  let boostMultiplierEffective = boostMultiplier > 2 ? 2 : boostMultiplier;
  // console.log("boostMultiplier:", boostMultiplier);
  // console.log("effective boostMultiplier:", boostMultiplierEffective);
  //render:
  c.clearRect(0, 0, WIDTH, HEIGHT);

  //(1) draw & update others
  for (let p in players) {
    //update other players by interpolating velocity
    players[p].loc = vec.add(players[p].loc, vec.scalar(players[p].vel, dt));
    // console.log("players[p].loc:", players[p].loc);
    drawPlayer(players[p].color, players[p].loc);
  }

  //(2) draw & update me:
  // update location

  localPlayer.loc = vec.add(
    localPlayer.loc,
    vec.normalized(directionPressed, walkspeed * dt),
    vec.normalized(boostDir, boostMultiplierEffective * walkspeed * dt)
  );
  // console.log("loc: ", loc);
  drawPlayer(localPlayer.color, localPlayer.loc, true);


  // draw & update hooks
  for (let h of localPlayer.hooks) {
    h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
    drawHook(localPlayer.color, localPlayer.loc, h.loc);
  }

  // if update velocity, send info to server
  if (!vec.equals(sent.vel, localPlayer.vel)) {
    console.log("sending loc/vel");
    send.updateloc();
    sent.vel = { ...localPlayer.vel };
  }

  window.requestAnimationFrame(newFrame);
}




/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      if (!keysPressed.has(key)) {
        directionPressed.y += 1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["down"]:
      if (!keysPressed.has(key)) {
        directionPressed.y += -1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["left"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += -1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["right"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += 1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
  }

  if (movementDirChanged) { //ie WASD was pressed, not some other key
    boost_updateOnPress(key);
  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      if (keysPressed.has(key)) {
        directionPressed.y -= 1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["down"]:
      if (keysPressed.has(key)) {
        directionPressed.y -= -1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["left"]:
      if (keysPressed.has(key)) {
        directionPressed.x -= -1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["right"]:
      if (keysPressed.has(key)) {
        directionPressed.x -= 1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
  }

  if (movementDirChanged) {
    boost_updateOnRelease(key);
  }
});


document.addEventListener('mousedown', function (event) {
  switch (event.button) {
    //left click:
    case 0:
      let mousePos = { x: event.clientX - canv_left, y: -(event.clientY - canv_top) };
      let hookDir = vec.normalized(vec.add(vec.negative(localPlayer.loc), mousePos)); //points to mouse from player
      let playerVel_projectedOn_hookDir = vec.dot(localPlayer.vel, hookDir);
      let hook = {
        vel: vec.normalized(hookDir, hookspeed + playerVel_projectedOn_hookDir),
        loc: vec.add(localPlayer.loc, vec.normalized(hookDir, playerRadius)),
      };
      localPlayer.hooks.push(hook);
      // console.log("projvel", vec.mag(hook.vel));
      break;
  }
});


document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('scroll', event => event.preventDefault());

// TODO: test out moveTime in playermove and updateloc
/**
Socket events sent:
  join (username, callback):
  - server: calls callback, emits newplayer to all others
  - note that client must wait for callback since it initializes world, players, and localPlayer 
  updateloc (loc, vel):
  - server: updates player's loc & vel , emits loc & vel to all others

Socket events received:
  connect(whenConnect):
  - client: sends join to server, and waits for callback to be run
  playerjoin(playerid, username, loc):
  - client: adds player to players
  playermove(playerid, loc, vel):
  - client: sets playerid's loc to loc
  playerdisconnect(playersocketid):
  - client: removes playersocketid from players
*/



const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (playerobj, serverPlayers, serverWorld, pRad, wSpd, hRad, hSpd, serverA, serverB) => {
    localPlayer = playerobj;
    players = serverPlayers;
    world = serverWorld;
    playerRadius = pRad;
    walkspeed = wSpd;
    hookRadius = hRad;
    hookspeed = hSpd;
    a = serverA;
    b = serverB;
  };
  await send.join(joinCallback);

  console.log("localPlayer", localPlayer);
  console.log("players", players);
  console.log("world", world);
  console.log("playerRadius", playerRadius);
  console.log("walkspeed", walkspeed);
  console.log("hookRadius", hookRadius);
  console.log("hookspeed", hookspeed);
  console.log("a", a);
  console.log("b", b);
  // once get here, know that world, players, and loc are defined  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const playerJoin = (playerid, playerobj) => {
  console.log("player joining", playerid, playerobj);
  players[playerid] = playerobj;
  console.log("players", players);
}
socket.on('playerjoin', playerJoin);



const playerMove = (playerid, newLoc, newVel) => {
  console.log("player moved", playerid, newLoc, newVel);
  players[playerid].loc = newLoc;
  players[playerid].vel = newVel;
}
socket.on('playermove', playerMove);



const playerDisconnect = (playerid) => {
  console.log("player left", playerid);
  delete players[playerid];
  console.log("players", players);
}
socket.on('playerdisconnect', playerDisconnect);



socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
