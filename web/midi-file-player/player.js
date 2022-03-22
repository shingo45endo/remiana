export class MidiPlayer {
	constructor(eventHandler, notifyHandler) {
		this._eventHandler = eventHandler;
		this._notifyHandler = notifyHandler;
		this._events = [];
		this._timerId = 0;
		this._playSpeed = 1.0;
		this._sentTimeStamp = 0.0;

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

		// Sets the current timestamp and event as the base point.
		// Note: If any "reserved" MIDI events exist (= the latest event's timestamp is ahead to the current timestamp),
		// keeps the current latest event's timestamp to keep the order of the MIDI events.
		this._sentTimeStamp = Math.max(performance.now(), this._sentTimeStamp);

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
		if (speed === this._playSpeed) {
			return;
		}

		this._playSpeed = speed;

		// Re-triggers the main loop.
		if (this._state === 'play') {
			this._clearTimeOut();
			this._doMainLoop();
		}
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

	getCurrentUsec(timestamp = -1) {
		if (timestamp >= 0 && this._sentIndex >= 0) {
			if (this._state === 'play' || timestamp < this._sentTimeStamp) {
				return Math.max(this._events[this._sentIndex].usec + (timestamp - this._sentTimeStamp) * 1000 * this._playSpeed, 0.0);
			} else {
				return this._events[this._sentIndex].usec;
			}
		} else {
			return 0.0;
		}

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
		if (this._state !== 'play' || this._events.length === 0) {
			console.warn('Something wrong.');
			return;
		}

		// Determines which events to be handled.
		const now = performance.now();
		if (this._sentTimeStamp === 0.0) {
			console.assert(this._sentIndex < 0);
			this._sentTimeStamp = now;
		}
		const baseEvent   = (this._sentIndex >= 0) ? this._events[this._sentIndex] : this._events[0];
		const currentUsec = baseEvent.usec + (now - this._sentTimeStamp) * 1000 * this._playSpeed;
		const preprocessUsec = currentUsec + this._preprocessMsec * 1000 * this._playSpeed;

		const baseTimestamp = this._sentTimeStamp;
		const sendEvents = [];
		for (let i = this._sentIndex + 1; i < this._events.length; i++) {
			const event = this._events[i];
			if (event.usec > preprocessUsec) {
				break;
			}

			const timestamp = Math.max(baseTimestamp + ((event.usec - baseEvent.usec) / 1000 / this._playSpeed), this._sentTimeStamp);
			sendEvents.push({...event, timestamp});

			this._sentIndex = i;
			this._sentTimeStamp = timestamp;
		}

		// Sends MIDI events.
		if (sendEvents.length > 0) {
			this._eventHandler(sendEvents);
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
