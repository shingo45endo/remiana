export class MidiPlayer {
	constructor(eventHandler, notifyHandler) {
		this._eventHandler = eventHandler;
		this._notifyHandler = notifyHandler;
		this._events = [];
		this._timerId = 0;
		this._playSpeed = 1.0;
		this._nextSpeed = 1.0;

		this.stop();
		this.setInterval(100, 500);	// default values

		// Makes and runs a worker for waking up periodically.
		try {
			const wakeUpInterval = 5000;
			const srcTxt = `setInterval(() => {self.postMessage(null)}, ${wakeUpInterval});`;
			const worker = new Worker(`data:text/javascript;base64, ${btoa(srcTxt)}`);
			worker.onmessage = () => {
				// Kicks the main loop.
				if (this._state === 'play') {
					this._clearTimeOut();
					this._doMainLoop();
				}
			};
		} catch (e) {
			console.error(e);
		}
	}

	setSong(song) {
		this.stop();

		this._events = makeEventList(song);
	}

	stop() {
		this._sentIndex = -1;
		this._sentTimings = [];

		this._clearTimeOut();
		this._changeState('stop');
	}

	play() {
		if (this._state === 'play') {
			return;
		}
		if (this._events.length === 0) {
			return;
		}

		// Clears the timing logs before the current timestamp.
		// Note: In most cases, all logs will be cleared.
		// If any "reserved" MIDI events exist, one element (with timestamp which is ahead to the current timestamp) will remain.
		const timestamp = performance.now();
		const position = this.getCurrentUsec(timestamp);
		this._sentTimings = this._sentTimings.filter((e) => e.timestamp >= timestamp);
		if (this._sentTimings.length === 0) {
			this._sentTimings.push({timestamp, position});
		}
		console.assert(this._sentTimings.length === 1);

		// Kicks the main loop.
		this._clearTimeOut();
		this._changeState('play');
		this._doMainLoop();
	}

	pause() {
		if (this._state !== 'play') {
			return;
		}

		this._clearTimeOut();
		this._changeState('pause');
	}

	setSpeed(speed) {
		console.assert(speed > 0.0);

		this._nextSpeed = speed;
	}

	setInterval(intervalMsec, preprocessMsec) {
		console.assert(intervalMsec > 0);
		console.assert(preprocessMsec > 0);
		console.assert(intervalMsec <= preprocessMsec);
		this._intervalMsec = intervalMsec;
		this._preprocessMsec = preprocessMsec;

		// Re-triggers the main loop.
		if (this._timerId) {
			this._clearTimeOut();
			this._doMainLoop();
		}
	}

	getCurrentUsec(timestamp) {
		console.assert(!Number.isNaN(timestamp) && timestamp >= 0.0);
		if (this._sentTimings.length === 0) {
			return 0.0;
		}

		// Calculates the current playing position.
		let position = 0.0;
		const last = this._sentTimings[this._sentTimings.length - 1];
		const index = this._sentTimings.findIndex((e) => timestamp < e.timestamp);
		if (index <= 0) {	// Including the case where index === 0.
			// Calculates from the base position and past time.
			position = Math.max(last.position + (timestamp - last.timestamp) * 1000 * this._playSpeed, 0.0);

		} else {
			// Calculates from the position between two points.
			const begin = this._sentTimings[index - 1];
			const end   = this._sentTimings[index];
			console.assert(begin.timestamp <= timestamp && timestamp <= end.timestamp);
			const rate = (timestamp - begin.timestamp) / (end.timestamp - begin.timestamp);
			console.assert(0.0 <= rate && rate <= 1.0);
			position =  begin.position + (end.position - begin.position) * rate;
		}

		// If the current state is not "play", the current playing position is not advanced beyond the last sent position.
		return (this._state === 'play') ? position : Math.min(position, last.position);
	}

	getTotalUsec() {
		const len = this._events.length;
		return (len > 0) ? this._events[len - 1].usec : 0.0;
	}

	_changeState(state) {
		console.assert(['stop', 'play', 'pause'].includes(state));
		if (state === this._state) {
			return;
		}

		this._state = state;
		if (this._notifyHandler) {
			this._notifyHandler(this._state);
		}
	}

	_doMainLoop() {
		if (this._state !== 'play' || this._events.length === 0 || this._sentTimings.length === 0) {
			console.warn('Something wrong.');
			return;
		}

		// Reflects the change of play speed.
		this._playSpeed = this._nextSpeed;

		// Determines which events to be handled.
		const preprocessUsec = this.getCurrentUsec(performance.now()) + this._preprocessMsec * 1000 * this._playSpeed;
		const base = this._sentTimings[this._sentTimings.length - 1];
		const sendEvents = [];
		for (let i = this._sentIndex + 1; i < this._events.length; i++) {
			const event = this._events[i];
			if (event.usec > preprocessUsec) {
				break;
			}

			// Adds a timestamp that the event will be sent.
			const timestamp = base.timestamp + ((event.usec - base.position) / 1000 / this._playSpeed);
			sendEvents.push({...event, timestamp});
		}
		this._sentIndex += sendEvents.length;

		// Handles the chosen events.
		if (sendEvents.length > 0) {
			// Sends MIDI events.
			this._eventHandler(sendEvents);

			// Stores timing logs.
			const {timestamp, usec} = sendEvents[sendEvents.length - 1];
			console.assert(usec === this._events[this._sentIndex].usec);
			this._sentTimings.push({timestamp, position: usec});
		}

		// If the current position is the end of the song, moves to "stop" state.
		if (this._sentIndex < this._events.length - 1) {
			this._setTimeOut(this._intervalMsec);
		} else {
			this.stop();
		}
	}

	_setTimeOut(msec = 0) {
		this._timerId = setTimeout(() => {
			this._doMainLoop();
		}, msec);
	}

	_clearTimeOut() {
		if (this._timerId) {
			clearTimeout(this._timerId);
		}
		this._timerId = 0;
	}
}

function makeEventList(song) {
	if (!song) {
		return [];
	}

	const portNos = song.portMap?.portNos;
	return song.MTrks.map((mtrk, i) => mtrk.events.map((event) => ({...event, portNo: portNos?.[i] ?? 0}))).flat().sort((a, b) => a.tick - b.tick).map((event) => {
		const {tick} = event;
		return {...event, usec: song.tempoMap.get(tick).usec};
	});
}
