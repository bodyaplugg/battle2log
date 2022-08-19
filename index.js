const express = require('express'),
      app = express(),
      fs = require('fs'),
      stats = require('./stats'),
      rankslist = require('./ranks'),
      fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

app.set('view engine', 'ejs');
const port = process.env.PORT || 3000;

app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));

app.get('/', async function (req, res){
  var serverslist = [], servers = [];
  pages = await fetch('https://api.bflist.io/bf2/v1/servers/1', {method: 'get', headers: {"Content-type": "application/json"}, });
  pages = pages.headers.get('x-total-pages');

  if (req.query.page > pages) page = 1;

  for (var i = 1; i <= pages; i++) {
    servers = await fetch('https://api.bflist.io/bf2/v1/servers/' + i, {method: 'get', headers: {"Content-type": "application/json"}, });
    servers = await servers.json();
    for (var j = 0; j < 50; j++) {
      if (servers[j]) serverslist[i * 50 - 50 - 1 + j] = servers[j]
    }
  }

  servers = sortPlayersDown(serverslist);

  var bf2hub = await fetch('https://api.gametools.network/bf2/statusarray/?service=bf2hub&days=7', {method: 'get', headers: {"Content-type": "application/json"}, });
  bf2hub = await bf2hub.json();

  var playbf2 = await fetch('https://api.gametools.network/bf2/statusarray/?service=playbf2&days=7', {method: 'get', headers: {"Content-type": "application/json"}, });
  playbf2 = await playbf2.json();

  var soldierAmount = []
  for (var i = 1; i <= 7; i++){
    soldierAmount[i - 1] = (bf2hub.soldierAmount[i * 24] + playbf2.soldierAmount[i * 24])
  }

  res.render('index', {servers: serverslist, soldierAmount: soldierAmount});
});

app.get('/search/', async function (req, res) {
  if (!req.query.player || !req.query.platform) return res.redirect('/');
  if (req.query.platform != 'bf2hub' && req.query.platform != 'playbf2') return res.redirect('/');
  var players = await stats.lambdaHandler({path: 'searchforplayers', queryStringParameters: {nick: req.query.player, project: req.query.platform}});
  players = JSON.parse(players.body);
  async function getranks(players, platform){
    var ranks = [];
    for (var i = 0; i < players.length; i++) {
      ranks[i] = await stats.lambdaHandler( {path: 'getrankinfo', queryStringParameters: {pid: players[i].pid, project: platform}});
      ranks[i] = JSON.parse(ranks[i].body);
    }
    return ranks;
  };
  var ranks = await getranks(players.players, req.query.platform);
  res.render('search', {players: players.players, ranks: ranks, platform: req.query.platform, player: req.query.player});
});

app.get('/profile/', async function (req, res) {
  if (!req.query.pid) return res.redirect('/');
  if (req.query.platform && req.query.platform != 'bf2hub' && req.query.platform != 'playbf2') return res.status(404).render('404');
  var info, platform = req.query.platform;
  if (!req.query.platform) {
    info = await stats.lambdaHandler({path: 'getplayerinfo', queryStringParameters: {pid: req.query.pid, project: 'bf2hub'}});
    info = JSON.parse(info.body);
    platform = "bf2hub";
    if (info.errors) {
      info = await stats.lambdaHandler({path: 'getplayerinfo', queryStringParameters: {pid: req.query.pid, project: 'playbf2'}});
      info = JSON.parse(info.body);
      platform = "playbf2";
      if (info.errors) return res.status(404).render('404');
    }
  } else {
    info = await stats.lambdaHandler({path: 'getplayerinfo', queryStringParameters: {pid: req.query.pid, project: platform}});
    info = JSON.parse(info.body);
    if (info.errors) return res.status(404).render('404');
  }

  var rank = await stats.lambdaHandler( {path: 'getrankinfo', queryStringParameters: {pid: req.query.pid, project: platform}});
  rank = JSON.parse(rank.body);
  if (rank.errors) return res.status(404).render('404');

  var unlocks = await stats.lambdaHandler( {path: 'getunlocksinfo', queryStringParameters: {pid: req.query.pid, project: platform}});
  unlocks = JSON.parse(unlocks.body)
  if (unlocks.errors) return res.status(404).render('404');

  var awards = await stats.lambdaHandler( {path: 'getawardsinfo', queryStringParameters: {pid: req.query.pid, project: platform}});
  awards = JSON.parse(awards.body);
  if (awards.errors) return res.status(404).render('404');

  var livestats = await fetch('https://api.bflist.io/bf2/v1/players/' +  info.player.nick, {method: 'get', headers: {"Content-type": "application/json"}, });
  var server = await fetch('https://api.bflist.io/bf2/v1/players/' +  info.player.nick + '/server', {method: 'get', headers: {"Content-type": "application/json"}, });

  res.render('profile', {ranks: rankslist, info: info, rank: rank, unlocks: unlocks, awards: awards, livestats: await livestats.json(), server: await server.json(), platform: platform});
});

app.get('/leaderboard/', async function (req, res) {
  var bf2hub = await stats.lambdaHandler( {path: 'getleaderboard', queryStringParameters: {project: 'bf2hub'}});
  bf2hub = JSON.parse(bf2hub.body);
  if (bf2hub.errors) return res.status(404).render('404');

  res.render('leaderboard', {bf2hub: bf2hub.players});
});

app.get('/servers/', async function (req, res) {
  var page, sort, serverslist = [], servers = [];

  if (!req.query.page) page = 1;
  else page = req.query.page;

  if (!req.query.sort) sort = 'playersdown';
  else sort = req.query.sort;

  pages = await fetch('https://api.bflist.io/bf2/v1/servers/1', {method: 'get', headers: {"Content-type": "application/json"}, });
  pages = pages.headers.get('x-total-pages');

  if (req.query.page > pages) page = 1;

  for (var i = 1; i <= pages; i++) {
    servers = await fetch('https://api.bflist.io/bf2/v1/servers/' + i, {method: 'get', headers: {"Content-type": "application/json"}, });
    servers = await servers.json();
    for (var j = 0; j < 50; j++) {
      if (servers[j]) serverslist[i * 50 - 50 - 1 + j] = servers[j]
    }
  }

  if (sort == 'playersup') servers = sortPlayersUp(serverslist);
  else if (sort == 'playersdown') servers = sortPlayersDown(serverslist);
  else if (sort == 'nameup') servers = sortNameUp(serverslist);
  else if (sort == 'namedown') servers = sortNameDown(serverslist);
  else if (sort == 'mapup') servers = sortMapUp(serverslist);
  else if (sort == 'mapdown') servers = sortMapDown(serverslist);
  else servers = sortPlayersDown(serverslist);

  res.render('servers', {servers: serverslist, pages: pages, page: page, sort: sort});
});

app.get('/server/', async function (req, res) {
  if (!req.query.ip || !req.query.port) return res.status(404).render('404');
  var ip = req.query.ip, port = req.query.port;

  var server = await fetch('https://api.bflist.io/bf2/v1/servers/' + ip + ':' + port, {method: 'get', headers: {"Content-type": "application/json"}, });
  server = await server.json();
  if (server.errors) return res.status(404).render('404');

  res.render('server', {server: server});
});

app.use(function(req,res){
    res.status(404).render('404');
});

app.listen(port);
console.log('Сервер запущен на порте: ' + port);

function sortPlayersDown(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].numPlayers < arr[j + 1].numPlayers) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}

function sortPlayersUp(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].numPlayers > arr[j + 1].numPlayers) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}

function sortNameUp(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].name < arr[j + 1].name) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}

function sortNameDown(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].name > arr[j + 1].name) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}

function sortMapUp(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].mapName < arr[j + 1].mapName) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}

function sortMapDown(arr) {
    for (var i = 0, endI = arr.length - 1; i < endI; i++) {
        var wasSwap = false;
        for (var j = 0, endJ = endI - i; j < endJ; j++) {
          if (arr[j] && arr[j + 1]) {
            if (arr[j].mapName > arr[j + 1].mapName) {
                var swap = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = swap;
                wasSwap = true;
            }
          }
        }
        if (!wasSwap) break;
    }
    return arr;
}
