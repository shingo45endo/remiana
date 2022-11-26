import {makeWarn} from './chunk_parser.js';

// MThd: Header Chunk
export function parseMThd(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'MThd');
	if (buf.byteLength !== 6) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		format:   view.getUint16(0),
		ntrks:    view.getUint16(2),
		division: view.getUint16(4),
	};
}

// MTrk: Track Chunk
export function parseMTrk(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);

	const events = [];

	let index = 0;
	let tick = 0;
	let runningStatusBytes = null;
	let isRunningStatus = false;
	let isEndOfTrack = false;
	while (index < buf.byteLength && !isEndOfTrack) {
		// Delta time
		const [dt, skip] = varNum(buf, index);
		if (index + skip > buf.byteLength) {
			logs.push(makeWarn('Invalid delta time', buf.subarray(index, index + Math.min(skip, 4))));
			break;
		}
		tick += dt;
		index += skip;

		// Event
		const obj = {tick};
		let statusByte = buf[index];
		if ((statusByte & 0x80) === 0) {
			// Checks whether the current running status is enabled or not.
			if (!isRunningStatus) {
				logs.push(makeWarn('Invalid status byte', buf.subarray(index, index + 1)));
				if (!runningStatusBytes) {
					break;
				}

				obj.isInvalid = true;
				logs.push(makeWarn('Recovered missing status byte from the disabled running status', runningStatusBytes));
				isRunningStatus = true;
			}

			console.assert(isRunningStatus && runningStatusBytes);
			statusByte = runningStatusBytes[0];

			// Gets the length of the next event.
			const len = getChannelMessageLength(statusByte) - 1;
			if (index + len > buf.byteLength) {
				logs.push(makeWarn(`Not enough '${tag}' size for channel message (w/o status byte)`, buf.subarray(index)));
				break;
			}

			// Makes an event object.
			obj.rawBytes = [
				runningStatusBytes,
				new Uint8Array(buf.buffer, buf.byteOffset + index, len),
			];
			obj.bytes = [...obj.rawBytes[0], ...obj.rawBytes[1]];
			index += len;

			// Checks whether the data byte(s) is valid or not.
			if (obj.rawBytes[1].some((e) => ((e & 0x80) !== 0))) {
				obj.isInvalid = true;
				logs.push(makeWarn('Invalid data byte(s) in a channel message (w/o status byte)', obj.rawBytes[1]));
			}

		} else {
			console.assert((statusByte & 0x80) !== 0);
			if (statusByte < 0xf0) {	// Channel message
				// Updates running status.
				runningStatusBytes = buf.subarray(index, index + 1);
				isRunningStatus = true;

				// Gets the length of the next event.
				const len = getChannelMessageLength(statusByte);
				if (index + len > buf.byteLength) {
					logs.push(makeWarn(`Not enough '${tag}' size for channel message`, buf.subarray(index)));
					break;
				}

				// Makes an event object.
				obj.rawBytes = [buf.subarray(index, index + len)];
				obj.bytes = [...obj.rawBytes[0]];
				index += len;

				// Checks whether the data byte(s) is valid or not.
				if (obj.bytes.slice(1).some((e) => ((e & 0x80) !== 0))) {
					obj.isInvalid = true;
					logs.push(makeWarn('Invalid data byte(s) in a channel message', obj.rawBytes[0]));
				}

			} else if (statusByte === 0xf0) {	// SysEx event
				// Gets the length of the next event.
				const [len, skip] = varNum(buf, index + 1);
				const size = 1 + skip + len;
				if (index + size > buf.byteLength) {
					logs.push(makeWarn(`Not enough '${tag}' size for SysEx event`, buf.subarray(index)));
					break;
				}

				// Disables running status.
				isRunningStatus = false;

				// Makes an event object.
				obj.rawBytes = [buf.subarray(index, index + size)];
				obj.bytes = [statusByte, ...buf.subarray(index + 1 + skip, index + size)];
				index += size;

				// Checks whether the data byte(s) in the SysEx message (except the last byte) is valid or not.
				if (obj.bytes.slice(1, -1).some((e) => ((e & 0x80) !== 0))) {
					obj.isInvalid = true;
					logs.push(makeWarn('Invalid data byte(s) in a SysEx message', obj.rawBytes[0]));
				}

			} else if (statusByte === 0xf7) {	// F7 SysEx event
				// Gets the length of the next event.
				const [len, skip] = varNum(buf, index + 1);
				const size = 1 + skip + len;
				if (index + size > buf.byteLength) {
					logs.push(makeWarn(`Not enough '${tag}' size for F7 SysEx event`, buf.subarray(index)));
					break;
				}

				// Disables running status.
				isRunningStatus = false;

				// Makes an event object.
				obj.rawBytes = [buf.subarray(index, index + size)];
				obj.bytes = [...buf.subarray(index + 1 + skip, index + size)];
				index += size;

			} else if (statusByte === 0xff) {	// Meta event
				// Gets the length of the next event.
				const [len, skip] = varNum(buf, index + 2);
				const size = 2 + skip + len;
				if (index + size > buf.byteLength) {
					logs.push(makeWarn(`Not enough '${tag}' size for meta event`, buf.subarray(index)));
					break;
				}

				// Disables running status.
				isRunningStatus = false;

				// Makes an event object.
				const kind = buf[index + 1];
				obj.rawBytes = [buf.subarray(index, index + size)];
				obj.bytes = [...obj.rawBytes[0]];
				index += size;

				// Exits the loop if an End of Track meta event appears.
				if (kind === 0x2f) {
					isEndOfTrack = true;
				}

			} else {
				logs.push(makeWarn('Invalid status byte (Not F0h, F7h or FFh)', buf.subarray(index, index + 1)));
				break;
			}
		}

		// Stores the event object to the array.
		events.push(obj);
	}

	// Checks whether the buffer ends without any leftovers or not.
	if (index !== buf.byteLength) {
		console.assert(index < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'${(isEndOfTrack) ? ' after the End of Track meta event' : ''}`, buf.subarray(index)));
	} else if (!isEndOfTrack) {
		logs.push(makeWarn('No End of Track meta event', buf.subarray(index)));
	}

	return {events};
}

function varNum(bytes, index) {
	let value = 0;
	let len = 0;
	let byte = 0;

	do {
		if (len >= 4 || index + len > bytes.length) {
			return [1 << 30, 1 << 30];
		}
		byte = bytes[index + len];
		value = (value << 7) | (byte & 0x7f);
		len++;
	} while ((byte & 0x80) !== 0);

	return [value, len];
}

function getChannelMessageLength(statusByte) {
	console.assert(0x80 <= statusByte && statusByte < 0xf0);
	return [3, 3, 3, 3, 2, 2, 3][((statusByte & 0x70) >> 4)];
}
