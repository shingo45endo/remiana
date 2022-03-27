const lengthTables = Object.freeze([
	...[...new Array(16)].fill(3),	// 0x80: Note Off
	...[...new Array(16)].fill(3),	// 0x90: Note On
	...[...new Array(16)].fill(3),	// 0xa0: Polyphonic Key Pressure
	...[...new Array(16)].fill(3),	// 0xb0: Control Change
	...[...new Array(16)].fill(2),	// 0xc0: Program Change
	...[...new Array(16)].fill(2),	// 0xd0: Channel Pressure
	...[...new Array(16)].fill(3),	// 0xe0: Pitch Bend Change
	0,	// 0xf0: System Exclusive Message
	2,	// 0xf1: MIDI Time Code Quarter Frame
	3,	// 0xf2: Song Position Pointer
	2,	// 0xf3: Song Select
	1,	// 0xf4: Undefined
	1,	// 0xf5: Undefined (Used as Port Select unofficially, but Web MIDI API doesn't allow any parameter)
	1,	// 0xf6: Tune Request
	1,	// 0xf7: End of System Exclusive
	1,	// 0xf8: Timing Clock
	1,	// 0xf9: Undefined
	1,	// 0xfa: Start
	1,	// 0xfb: Continue
	1,	// 0xfc: Stop
	1,	// 0xfd: Undefined
	1,	// 0xfe: Active Sensing
	1,	// 0xff: System Reset
]);
console.assert(lengthTables.length === 128);

const checkers = lengthTables.map((len) => {
	switch (len) {
	case 3:
		return (bytes) => (bytes.length === 3 && (bytes[1] & 0x80) === 0 && (bytes[2] & 0x80) === 0);

	case 2:
		return (bytes) => (bytes.length === 2 && (bytes[1] & 0x80) === 0);

	case 1:
		return (bytes) => (bytes.length === 1);

	case 0:
		return (bytes) => (bytes[0] === 0xf0 && bytes[bytes.length - 1] === 0xf7 && bytes.slice(1, -1).every((e) => (e & 0x80) === 0));

	default:
		console.assert(false);
		break;
	}
	return null;
});

function getMessageLength(statusByte) {
	if ((statusByte & 0x80) === 0) {
		return -1;
	}
	return lengthTables[statusByte - 0x80];
}

function isValidMessage(bytes) {
	return checkers[bytes[0] - 0x80](bytes);
}

export class MidiPort {
	constructor() {
		this.reset();
	}

	reset() {
		this._runningStatus = 0x00;
		this._restBytes = [];
		this._events = [];
	}

	popEvents() {
		const ret = this._events;
		this._events = [];
		return ret;
	}

	pushBytes(bytes) {
		console.assert(Array.isArray(bytes));	// It doesn't accept Uint8Array.

		// Normal case: Input bytes contain only single "complete" MIDI message and the rest buffer is empty.
		// Note: "complete" means that the MIDI message doesn't need a running status byte to parse.
		if (this._restBytes.length === 0) {
			const statusByte = bytes[0];
			if (bytes.length === getMessageLength(statusByte)) {
				if (isValidMessage(bytes)) {
					this._events.push(bytes);
					this._runningStatus = getNewRunningStatus(statusByte, this._runningStatus);
					return;
				}
			} else if (statusByte === 0xf0) {
				if (isValidMessage(bytes)) {
					this._events.push(bytes);
					this._runningStatus = 0x00;
					return;
				}
			}
		}

		// Irregular case: Incomplete message remains in the rest buffer or input bytes contain multiple MIDI messages.
		let restBytes = this._restBytes.concat([...bytes]);
		while (restBytes.length > 0) {
			// If the first byte isn't MSB-set, tries to apply running status byte.
			if ((restBytes[0] & 0x80) === 0) {
				// If running status byte cannot be applied, trashes the first byte and restart parsing.
				if ((this._runningStatus & 0x80) === 0) {
					restBytes = restBytes.slice(1);
					continue;
				}

				restBytes = [this._runningStatus, ...restBytes];
			}

			// Checks if the rest buffer can be considered as a MIDI event.
			const statusByte = restBytes[0];
			console.assert((statusByte & 0x80) !== 0);
			if (statusByte === 0xf7) {
				// Trashes single EOX byte and restart parsing the rest buffer from the next byte.
				restBytes = restBytes.slice(1);
				this._runningStatus = 0x00;
				continue;

			} else if (statusByte !== 0xf0) {
				// If the current buffer doesn't contain complete MIDI message, exits the loop.
				const len = getMessageLength(statusByte);
				if (len > restBytes.length) {
					break;
				}

				// Checks whether the current buffer for new MIDI message contains a real-time MIDI message or not.
				const indexRealtime = restBytes.slice(0, len).findIndex((e, i) => (i > 0 && e >= 0xf8));
				if (indexRealtime >= 0) {
					// Extracts and pushes the MSB-set byte as a real-time MIDI message and restart parsing.
					const eventBytes = [restBytes[indexRealtime]];
					console.assert(isValidMessage(eventBytes));
					this._events.push(eventBytes);
					restBytes.splice(indexRealtime, eventBytes.length);
					continue;
				}

				// Checks whether the new MIDI message is valid or not.
				const eventBytes = restBytes.slice(0, len);
				if (!isValidMessage(eventBytes)) {
					// Trashes the first byte and restart parsing.
					restBytes = restBytes.slice(1);
					this._runningStatus = 0x00;
					continue;

				} else {
					// Pushes a MIDI message.
					console.assert(isValidMessage(eventBytes));
					this._events.push(eventBytes);
					restBytes = restBytes.slice(len);
					this._runningStatus = getNewRunningStatus(statusByte, this._runningStatus);
				}

			} else {	// In case of SysEx
				this._runningStatus = 0x00;

				// Finds an MSB-set byte.
				const indexMsb = restBytes.findIndex((e, i) => (i > 0 && (e & 0x80) !== 0));
				if (indexMsb < 0) {
					// Exits the loop to wait for subsequent bytes by calling next pushBytes().
					break;
				}
				const msbByte = restBytes[indexMsb];
				if (msbByte >= 0xf8) {
					// Cuts and pushes the MSB-set byte as a real-time MIDI message and restart parsing.
					const eventBytes = [msbByte];
					console.assert(isValidMessage(eventBytes));
					this._events.push(eventBytes);
					restBytes.splice(indexMsb, eventBytes.length);
					continue;

				} else if (msbByte !== 0xf7) {
					// Trashes wrong bytes and restart parsing the rest buffer from the next MSB-set byte.
					restBytes = restBytes.slice(indexMsb);
					console.assert((restBytes[0] & 0x80) !== 0);
					continue;
				}

				// Pushes a SysEx message.
				const len = indexMsb + 1;
				const eventBytes = restBytes.slice(0, len);
				console.assert(isValidMessage(eventBytes));
				this._events.push(eventBytes);
				restBytes = restBytes.slice(len);
			}
		}

		// Updates the rest buffer.
		this._restBytes = restBytes;
		console.assert(this._restBytes.length === 0 || !isValidMessage(this._restBytes));
	}
}

function getNewRunningStatus(statusByte, runningStatus) {
	console.assert((statusByte & 0x80) !== 0);

	if (statusByte < 0xf0) {
		return statusByte;
	} else if (statusByte < 0xf8) {
		return 0x00;
	} else {
		return runningStatus;
	}
}
