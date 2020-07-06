//https://socket.io/docs/server-api/
const server = require('http').Server();
const io = require('socket.io')(server);
const { vec } = require('../common/vector.js');

const playerRadius = 20; //pix
const walkspeed = 124 / 1000; // pix/ms
const hookRadius = 10; //circle radius
const hookspeed = 200 / 1000; //pix


const a0 = 1 / (160 * 16); // boost decay v^2 term
const b0 = 1 / (80 * 16); // boost decay constant term
const c0 = 1 / (37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started


//TODO: SEND ONLY WHAT YOU NEED (loc, not vel or anything else)

const boostMultEffective_max = 2.5;
const boostMult_max = 3;
const hookCutoffDistance = 500;

const WAIT_TIME = 1; // # ms to wait to broadcast players object



// PLAYER INFO TO BE BROADCAST (GLOBAL)
var players = {
  /*
    "initialPlayer (socket.id)": {
      loc: { x: 0, y: 0 },//generateStartingLocation(),
      vel: { x: 0, y: 0 },
  
      username: "billybob",
      color: "orange",
      hooks: new Set(
        {
          loc: { x: 0, y: 0 },
          vel: { x: 0, y: 0 },
          to: null
        }
      )
    }
    */
};


// LOCAL (SERVER SIDE) PLAYER INFO
var playersInfo = {
  /*
    "initialPlayer (socket.id)": {
      //NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
      boost: {
        Dir: null, // direction of the boost (null iff no boost)
        Key: null, // key that needs to be held down for current boost to be active
        Multiplier: 0, // magnitude of boost in units of walkspeed
        recentKeys: [], //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
        recentKeysRepeat: false,
      },
  
      walk: {
        directionPressed: { x: 0, y: 0 }, //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)
        keysPressed: new Set(), // contains 'up', 'down', 'left', and 'right'
      }
    },
  */
}

var world = {};




//returns true iff key 1 is parallel and in the opposite direction to key 2 
var keyDirection_isOpposite = (d1, d2) => {
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

// assumes these are normalized
var keyVectors = {
  'up': { x: 0, y: 1 },
  'down': { x: 0, y: -1 }, //must = -up
  'left': { x: -1, y: 0 }, //must = -right
  'right': { x: 1, y: 0 }
}


// if k is null, there is no orthogonal key to a and b being pressed, or there are 2
// if k is not, it's the single key pressed that's orthogonal to key k
var keysPressed_singleOrthogonalTo = (pInfo, d) => {
  let keysPressed = pInfo.walk.keysPressed;
  let ret = null;
  switch (d) {
    case "left":
    case "right":
      if (keysPressed.has("up")) ret = "up";
      if (keysPressed.has("down")) {
        if (ret) ret = null;
        else {
          ret = "down";
        }
      }
      break;
    case "up":
    case "down":
      if (keysPressed.has("left")) ret = "left";
      if (keysPressed.has("right")) {
        if (ret) ret = null;
        else {
          ret = "right";
        }
      }
      break;
  }
  return ret;
}




var recentKeys_insert = (pInfo, key) => {
  if (key === pInfo.boost.recentKeys[1]) { //repeat
    pInfo.boost.recentKeysRepeat = true;
  } else { // no repeat
    pInfo.boost.recentKeysRepeat = false;
    pInfo.boost.recentKeys[0] = pInfo.boost.recentKeys[1];
    pInfo.boost.recentKeys[1] = key;
  }
}
// stops player from being able to continue / initiate boost (they have to redo as if standing still with no keys pressed yet)
var boostReset = (pInfo) => {
  pInfo.boost.Multiplier = 0;
  pInfo.boost.Dir = null;
  pInfo.boost.Key = null;
  pInfo.boost.recentKeys = [];
  pInfo.boost.recentKeysRepeat = false;
}
// creates a boost in direction of key k, with boostMultipler increased by inc
var boostSet = (pInfo, k, inc) => {
  pInfo.boost.Multiplier += inc;
  if (pInfo.boost.Multiplier <= 0) boostReset(pInfo);
  else {
    pInfo.boost.Dir = keyVectors[k];
    pInfo.boost.Key = k;
  }
}





// Can assume that the last entry in recentKeys is not null 
// since this is called after a WASD key is pressed
// updates pInfo.boost.Dir and pInfo.boost.Key
var boost_updateOnPress = (pInfo, key) => {

  recentKeys_insert(pInfo, key);

  let a = pInfo.boost.recentKeys[0];
  let b = pInfo.boost.recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  let c = keysPressed_singleOrthogonalTo(pInfo, b);  // c is the key of the BOOST DIRECTION!!! (or null if no boost)

  // have no boost yet, so initialize
  if (!pInfo.boost.Dir) {
    // starting boost: no boost yet, so initialize 
    // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
    if (keyDirection_isOpposite(a, b) && c) {
      boostSet(pInfo, c, .5);
    }
  }
  // currently have boost, continue it or lose it
  else if (c) {
    // continue boost
    if (c === pInfo.boost.Key && !pInfo.boost.recentKeysRepeat && keyDirection_isOpposite(a, b)) {
      boostSet(pInfo, c, .5);
    }
    // repeat same key twice
    else if (c === pInfo.boost.Key && pInfo.boost.recentKeysRepeat) {
      boostSet(pInfo, c, -.1);
    }
    // change boost direction
    else if (keyDirection_isOpposite(b, pInfo.boost.Key)) {
      boostSet(pInfo, c, 1);
    }
  }
  else {
    boostReset(pInfo);
  }

}

var boost_updateOnRelease = (pInfo, keyReleased) => {
  if (pInfo.boost.Key) { // W and A/D boost
    if (pInfo.walk.keysPressed.size === 0
      || (keyReleased === pInfo.boost.Key && pInfo.walk.keysPressed.size !== 1)) { //reset boost
      boostReset(pInfo);
    }
  }
}


var walk_updateOnPress = (pInfo, dir) => {
  let pDirectionPressed = pInfo.walk.directionPressed;
  switch (dir) {
    case "up":
    case "down":
    case "left":
    case "right":
      pInfo.walk.directionPressed = vec.add(pDirectionPressed, keyVectors[dir]);
      break;
  }
}



var walk_updateOnRelease = (pInfo, dir) => {
  let pDirectionPressed = pInfo.walk.directionPressed;
  switch (dir) {
    case "up":
    case "down":
    case "left":
    case "right":
      pInfo.walk.directionPressed = vec.add(pDirectionPressed, vec.negative(keyVectors[dir]));
      break;
  }
}

var velocity_decay = (pInfo, dt) => {
  //boost decay
  if (pInfo.boost.Dir) {
    pInfo.boost.Multiplier -= dt * (a0 * Math.pow(pInfo.boost.Multiplier, 2) + b0 + c0 / (pInfo.boost.Multiplier + d0));
    if (pInfo.boost.Multiplier <= 0) pInfo.boost.Multiplier = 0;
    else if (pInfo.boost.Multiplier > boostMult_max) pInfo.boost.Multiplier = boostMult_max;
  }
}

var velocity_update = (pInfo, p) => {
  //calculate velocity
  if (!pInfo.boost.Dir) {
    p.vel = vec.normalized(pInfo.walk.directionPressed, walkspeed);
  }
  else {
    let pBoostMultiplierEffective = pInfo.boost.Multiplier > boostMultEffective_max ? boostMultEffective_max : pInfo.boost.Multiplier;
    p.vel = vec.add(vec.normalized(pInfo.walk.directionPressed, walkspeed),
      vec.normalized(pInfo.boost.Dir, pBoostMultiplierEffective * walkspeed)); // walk vel + boost vel
  }
}







const generateStartingLocation = () => {
  return { x: 10 + Math.random() * 20, y: 10 + Math.random() * -100 };
}

const generateRandomColor = () => {
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

const generateNewPlayerAndInfo = (username) => {
  return [
    {// PLAYER:
      loc: generateStartingLocation(),
      vel: { x: 0, y: 0 },
      username: username,
      color: generateRandomColor(),
      hooks: [],
    },
    // PLAYER INFO:
    {//NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
      boost: {
        Dir: null, // direction of the boost (null iff no boost)
        Key: null, // key that needs to be held down for current boost to be active
        Multiplier: 0, // magnitude of boost in units of walkspeed
        recentKeys: [], //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
        recentKeysRepeat: false,
      },
      walk: {
        directionPressed: { x: 0, y: 0 }, //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)
        keysPressed: new Set(), // contains 'up', 'down', 'left', and 'right'
      }
    }
  ]
}


// fired when client connects
io.on('connection', (socket) => {

  //set what server does on different events
  socket.on('join', (username, callback) => {
    let [newPlayer, newPlayerInfo] = generateNewPlayerAndInfo(username);

    players[socket.id] = newPlayer;
    playersInfo[socket.id] = newPlayerInfo;

    callback(
      players,
      world,
      playerRadius,
      hookRadius,
    );


    console.log("players:", players);
    // console.log(`connected socket.id: ${socket.id}`);
    // console.log(`players: ${JSON.stringify(players, null, 3)}`);
  });



  socket.on('keypressed', (dir) => {// dir is up, down, left, or right
    let pInfo = playersInfo[socket.id];
    if (!pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.add(dir);
      walk_updateOnPress(pInfo, dir);
      boost_updateOnPress(pInfo, dir);
    }
  });

  socket.on('keyreleased', (dir) => {// dir is up, down, left, or right
    let pInfo = playersInfo[socket.id];
    if (pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.delete(dir);
      walk_updateOnRelease(pInfo, dir);
      boost_updateOnRelease(pInfo, dir);
    }
  });

  socket.on('throwhook', (hookDir) => {// hookDir is {x, y}
    let p = players[socket.id];
    hookDir = vec.normalized(hookDir);
    let playerVel_projectedOn_hookDir = vec.dot(p.vel, hookDir);
    let hook = {
      vel: vec.normalized(hookDir, hookspeed + playerVel_projectedOn_hookDir),
      loc: vec.add(p.loc, vec.normalized(hookDir, playerRadius)),
      to: null,
    };
    p.hooks.push(hook);

  });

  socket.on('disconnect', (reason) => {
    delete players[socket.id];
    socket.broadcast.emit('playerdisconnect', socket.id);
  });
});




server.listen(3001, function () {
  console.log('listening on *:3001');
});




// ---------- RUN GAME ----------

var prevtime = null;
const runGame = () => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  // console.log("dt:", dt);

  for (let pid in players) {
    let pInfo = playersInfo[pid];
    let p = players[pid];

    // boost decay & update velocity
    velocity_decay(pInfo, dt);
    velocity_update(pInfo, p);

    // update player location
    p.loc = vec.add(p.loc, vec.scalar(p.vel, dt));

    for (let h of p.hooks) {
      // update hook location
      h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
      // delete hook if too far
      if (vec.magnitude(vec.add(h.loc, vec.negative(p.loc))) > hookCutoffDistance) {
        p.hooks = [];
        continue;
      }
      //check for collisions
      for (let pid2 in players) {
        if (pid2 == pid) continue;
        let p2 = players[pid2];
        if (vec.isCollided(p2.loc, playerRadius, h.loc, hookRadius)) {
          h.loc = p2.loc;
          h.vel = p2.vel;
          continue;
        }
      }

    }
  }



  io.emit('serverimage', players, world);
}
setInterval(runGame, WAIT_TIME);
