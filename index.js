const fs = require('fs')
const path = require('path')
const inquirer = require('inquirer');
const mpv = require('node-mpv');
const clear = require("cli-clear");

class Radio {
	constructor() {
		this.dataPath = path.join(__dirname, '/assets/data.json')
		this.data = JSON.parse(fs.readFileSync(this.dataPath).toString())
		this.genres = Object.keys(this.data)
		this.selectedGenre = null
		this.selectedRadio = null
		this.mpvPlayer = new mpv({ "verbose": false, "audio_only": true });
		process.on('SIGINT', this.quit.bind(this))
	}
	quit() {
		this.mpvPlayer.stop()
		process.exit(0)
	}
	updateTitle() {
		clear();
		console.log('\x1b[33m%s\x1b[0m', `///// CONSOLE RADIO - ${this.selectedRadio ? this.selectedRadio.title : ''} /////\n`)
	}
	play() {
		this.updateTitle()
		this.mpvPlayer.load(this.selectedRadio.radio)
		this.selectedRadio = null
		this.selectedGenre = null
		this.init()
	}
	selectGenre() {
		inquirer
			.prompt({
				name: 'genre',
				type: 'list',
				message: '> SELECT A GENRE',
				choices: this.genres.map(el => ({ name: el }))
			})
			.then(g => {
				this.selectedGenre = g['genre']
				this.selectRadio()
			});
	}
	selectRadio() {
		this.updateTitle()
		inquirer
			.prompt({
				name: 'radio',
				type: 'list',
				message: '> SELECT A RADIO',
				choices: this.data[this.selectedGenre].map(el => ({ name: el.title }))
			})
			.then(i => {
				this.selectedRadio = this.data[this.selectedGenre].find(el => el.title === i['radio'])
				this.play()
			})
	}
	init() {
		this.selectGenre()
	}
}
new Radio().init()
