export function makeTempoMap(song) {
	console.assert(song && song.MThd && song.MTrks);

	// Picks and sorts the timestamps from all the events.
	const timestamps = [...new Set(song.MTrks.reduce((p, c) => {
		console.assert(c.track);
		p.push(...c.track.keys());
		return p;
	}, []))].sort((a, b) => a - b);

	// Makes an empty tempo map.
	const tempoMap = new Map(timestamps.map((e) => [e, {}]));
	if (!tempoMap.has(0)) {
		tempoMap.set(0, {});
	}

	console.assert('division' in song.MThd);
	if ((song.MThd.division & 0x8000) === 0) {
		// [Normal mode]
		const division = song.MThd.division;

		// Sets an initial value.
		tempoMap.get(0).usecPerBeat = 500000;
		tempoMap.get(0).timeSignature = {numerator: 4, denominator: 4};

		// Picks up all the Tempo meta events and Time Signature meta events.
		for (const mtrk of song.MTrks) {
			console.assert(mtrk.track);
			for (const [timestamp, events] of mtrk.track.entries()) {
				console.assert(tempoMap.has(timestamp));
				for (const event of events) {
					console.assert(Array.isArray(event.bytes));
					const {bytes} = event;

					// Tempo meta event
					if (bytes.length === 6 && bytes[0] === 0xff && bytes[1] === 0x51 && bytes[2] === 0x03) {
						const usecPerBeat = (bytes[3] << 16) | (bytes[4] << 8) | bytes[5];
						Object.assign(tempoMap.get(timestamp), {usecPerBeat});
					}
					// Time Signature meta event
					if (bytes.length === 7 && bytes[0] === 0xff && bytes[1] === 0x58 && bytes[2] === 0x04) {
						const numerator = bytes[3];
						const denominator = 2 ** bytes[4];
						Object.assign(tempoMap.get(timestamp), {timeSignature: {numerator, denominator}});
					}
				}
			}
		}

		// Adds MBT information to each event.
		const lastTimestamp = Math.max(...timestamps);
		let timestamp = 0;
		let currentTimeSignature = tempoMap.get(timestamp).timeSignature;
		let meas = 1;
		while (timestamp <= lastTimestamp) {
			// Sets the current time signature if meta event is at the beginning of this measure.
			const obj = tempoMap.get(timestamp);
			if (obj && obj.timeSignature) {
				currentTimeSignature = obj.timeSignature;
			}

			// Ignores abnormal time signature.
			if (currentTimeSignature.denominator > 256) {
				currentTimeSignature = {numerator: 4, denominator: 4};
			}

			// Adds MBT to the objects in this measure.
			const beatTick = division / (currentTimeSignature.denominator / 4);
			const measureTick = beatTick * (currentTimeSignature.numerator || currentTimeSignature.denominator);
			const keys = [...tempoMap.keys()].filter((ts) => (timestamp <= ts && ts < timestamp + measureTick));
			for (const ts of keys) {
				Object.assign(tempoMap.get(ts), {mbt: {
					meas,
					beat: Math.trunc((ts - timestamp) / beatTick) + 1,
					tick: (ts - timestamp) % beatTick},
				});

				// Sets the current time signature if meta event is in the middle of this measure.
				if (tempoMap.get(ts).timeSignature) {
					currentTimeSignature = tempoMap.get(ts).timeSignature;
				}
			}

			timestamp += measureTick;
			meas++;
		}

		// Adds elapsed time to each event.
		let baseTimestamp = 0;
		let baseObj = tempoMap.get(baseTimestamp);
		baseObj.usec = 0;
		for (const [timestamp, obj] of tempoMap.entries()) {
			obj.usec = baseObj.usec + (timestamp - baseTimestamp) * baseObj.usecPerBeat / division;

			if (obj.usecPerBeat) {
				baseTimestamp = timestamp;
				baseObj = tempoMap.get(baseTimestamp);
			}
		}

	} else {
		// [Time-code-based mode]
		// Note: In case of time-code-based mode, this implementation ignores SMPTE Offset meta events.
		// The "tempo map" assumes that the time management is common in the whole tracks.
		// But, to take care of SMPTE Offset, the time flow might be different from track to track.
		const frameRate = -(new Int8Array([song.MThd.division >> 8]))[0];
		console.assert(frameRate >= 0);
		const subFrameRate = song.MThd.division & 0xff;
		const tickPerSec = frameRate * subFrameRate;

		// Adds SMPTE time code to each event.
		for (const [timestamp, obj] of tempoMap) {
			const sec = Math.trunc(timestamp / tickPerSec);
			Object.assign(obj, {
				smpte: {
					hours:            Math.trunc(sec / 60 / 60),
					minutes:          Math.trunc(sec / 60) % 60,
					seconds:          sec % 60,
					frames:           Math.trunc((timestamp % tickPerSec) / subFrameRate),
					fractionalFrames: timestamp % subFrameRate,
				},
				usec: timestamp * 1000 * 1000 / tickPerSec,
			});
		}
	}

	return tempoMap;
}
