var Chord = require('simple-peer-chord'),
	events = require('events'),
	util = require('util'),

/*
	BOOTSTRAP = {
		// replace url with your own signal-proxy address
		url: 'u.ofr.me:8088',
		opts: { transports:[ 'websocket' ] },
	},
*/
	BOOTSTRAP = new Chord({ }, true),
	TILESIZE = 100,
	TILEINDEX = x => Math.floor(x / TILESIZE - 0.5),
	TILEIN_FROM_INDEX = (i, j) => 'tile:' + i + ':' + j,
	TILEID_FROM_POS = p => TILEIN_FROM_INDEX(TILEINDEX(p.x), TILEINDEX(p.y)),
	RANDOM = (a, b) => Math.random() * (b - a) + a,

	KEYMAP = {
		left: 37,
		top: 38,
		right: 39,
		down: 40,
	}

function loopForever(fn, time) {
	requestAnimationFrame(time => loopForever(fn, time))
	fn(time || Date.now())
}

function Game() {
	this.canvas = document.createElement('canvas')
	this.canvas.width = 300
	this.canvas.height = 280
	this.canvas.tabIndex = 1
	this.canvas.addEventListener('keydown', e => this.handleKeyDown(e))
	this.canvas.drawContext = this.canvas.getContext('2d')
	this.canvas.drawOffsets = { x:0, y:0 }
	document.body.appendChild(this.canvas)

	this.net = new Chord({ }, BOOTSTRAP)
	this.net.on('player-update', data => this.handlePlayerUpdate(data))
	this.net.once('chord-start', _ => this.emit('chord-ready'))

	this.id = this.net.id
	this.player = {
		x: Math.floor(RANDOM(-1, 1) * TILESIZE / 10) * 10,
		y: Math.floor(RANDOM(-1, 1) * TILESIZE / 10) * 10,
	}
	this.objects = { [this.id]: this.player }
	this.tiles = { }

	events.EventEmitter.call(this)
	this.once('chord-ready', _ => {
		setInterval(_ => this.run(100), 100)
		loopForever(time => this.render(time))
		this.emit('ready')
	})
}

util.inherits(Game, events.EventEmitter)

Game.prototype.handleKeyDown = function(e) {
	if (e.which === KEYMAP.left)
		this.player.x -= 10
	else if (e.which === KEYMAP.top)
		this.player.y -= 10
	else if (e.which === KEYMAP.right)
		this.player.x += 10
	else if (e.which === KEYMAP.down)
		this.player.y += 10
	this.notifyPlayerUpdate()
}

Game.prototype.notifyPlayerUpdate = function() {
	var tileId = TILEID_FROM_POS(this.player),
		data = Object.assign({ id:this.id }, this.player)
	if (this.lastPlayerTileId && this.lastPlayerTileId !== tileId)
		this.net.publish(this.lastPlayerTileId, 'player-update', data)
	if (this.lastPlayerTileId = tileId)
		this.net.publish(this.lastPlayerTileId, 'player-update', data)
}

Game.prototype.handlePlayerUpdate = function(data) {
	var player = this.objects[data.id] || (this.objects[data.id] = { })
	player.x = data.x
	player.y = data.y
	player.active = Date.now()
}

Game.prototype.syncPlayerState = function() {
	Object.keys(this.tiles).forEach(id => this.net.subscribe(id))
	this.notifyPlayerUpdate()
}

Game.prototype.updateTiles = function() {
	var cv = this.canvas,
		ps = this.canvas.drawOffsets,
		tiles = { },
		mx = cv.width / 2 * 1.5,
		my = cv.height / 2 * 1.5

	for (var i = TILEINDEX(ps.x - mx), i1 = TILEINDEX(ps.x + mx); i <= i1; i ++)
		for (var j = TILEINDEX(ps.y - my), j1 = TILEINDEX(ps.y + my); j <= j1; j ++)
			tiles[TILEIN_FROM_INDEX(i, j)] = {
				x: i * TILESIZE,
				y: j * TILESIZE,
			}

	Object.keys(tiles).forEach(id => !this.tiles[id] && this.net.subscribe(id))
	Object.keys(this.tiles).forEach(id => !tiles[id] && this.net.unsubscribe(id))
	this.tiles = tiles
}

Game.prototype.recycleObjects = function() {
	var now = Date.now()
	Object.keys(this.objects).filter(id => id !== this.id).forEach(id => {
		var pl = this.objects[id],
			tileId = TILEID_FROM_POS(pl)
		if (!this.tiles[tileId] || !(now - pl.active < 5000))
			delete this.objects[id]
	})
}

Game.prototype.updateCanvasOffset = function() {
	var pl = this.player,
		cv = this.canvas,
		ps = cv.drawOffsets,
		mx = cv.width / 2 * 0.7,
		my = cv.height / 2 * 0.7,
		factor = 0.2,
		margin = 0

	margin = pl.x - (ps.x - mx)
	if (margin < 0) ps.x += margin * factor

	margin = (ps.x + mx) - pl.x
	if (margin < 0) ps.x -= margin * factor

	margin = pl.y - (ps.y - my)
	if (margin < 0) ps.y += margin * factor

	margin = (ps.y + my) - pl.y
	if (margin < 0) ps.y -= margin * factor
}

Game.prototype.run = function(dt) {
	this.updateTiles()

	this.lastSubTick = this.lastSubTick > 0 ? this.lastSubTick - dt :
		(this.syncPlayerState(), 2000)

	this.lastRecycleTick = this.lastRecycleTick > 0 ? this.lastRecycleTick - dt :
		(this.recycleObjects(), 2000)
}

Game.prototype.render = function(time) {
	var cv = this.canvas,
		dc = cv.drawContext,
		ps = cv.drawOffsets,
		dx = cv.width / 2 - ps.x,
		dy = cv.height / 2 - ps.y

	dc.clearRect(0, 0, cv.width, cv.height)

	dc.strokeStyle = '#ddd'
	dc.beginPath()
	Object.keys(this.tiles).forEach(id => {
		var tile = this.tiles[id]
		dc.rect(tile.x - TILESIZE/2 + dx, tile.y - TILESIZE/2 + dy, TILESIZE, TILESIZE)
		dc.fillText(id, tile.x + dx, tile.y + dy)
	})
	dc.closePath()
	dc.stroke()

	Object.keys(this.objects).forEach(id => {
		var pl = this.objects[id]
		dc.beginPath()
		dc.arc(pl.x + dx, pl.y + dy, 10, 0, Math.PI * 2, true)
		dc.closePath()

		var f = dc.fillStyle
		dc.fillStyle = pl === this.player ? 'red' : 'cyan'
		dc.fill()
		dc.fillStyle = f
	})

	this.updateCanvasOffset()
}

var initGame = _ => new Promise(resolve => new Game().once('ready', resolve)),
	initChord = _ =>new Promise(resolve => new Chord({ }, BOOTSTRAP).once('chord-start', resolve)),
	initAll =  _ => Promise.resolve()
		.then(initChord).then(initChord).then(initChord).then(initChord)
		.then(initChord).then(initChord).then(initChord).then(initChord)
		.then(initGame).then(initGame).then(initGame).then(initGame)

if (BOOTSTRAP.url) {
	var script = document.createElement('script')
	script.src = 'http://' + BOOTSTRAP.url + '/socket.io/socket.io.js'
	script.onload = initAll
	document.body.appendChild(script)
}
else {
	initAll()
}

