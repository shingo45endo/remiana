export function makeTempoMap(song) {
	console.assert(song && song.MThd && song.MTrks);

	// Picks and sorts the timestamps from all the events.
	const ticks = [...new Set(song.MTrks.map((mtrk) => mtrk.events).flat().sort((a, b) => a.tick - b.tick).map((event) => event.tick))];

	// Makes an empty tempo map.
	const tempoMap = new Map(ticks.map((e) => [e, {}]));
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
			console.assert(Array.isArray(mtrk.events));
			for (const event of mtrk.events) {
				const {tick, bytes} = event;
				console.assert(tempoMap.has(tick));
				console.assert(Array.isArray(bytes));

				// Tempo meta event
				if (bytes.length === 6 && bytes[0] === 0xff && bytes[1] === 0x51 && bytes[2] === 0x03) {
					const usecPerBeat = (bytes[3] << 16) | (bytes[4] << 8) | bytes[5];
					Object.assign(tempoMap.get(tick), {usecPerBeat});
				}
				// Time Signature meta event
				if (bytes.length === 7 && bytes[0] === 0xff && bytes[1] === 0x58 && bytes[2] === 0x04) {
					const numerator = bytes[3];
					const denominator = 2 ** bytes[4];
					Object.assign(tempoMap.get(tick), {timeSignature: {numerator, denominator}});
				}
			}
		}

		// Adds MBT information to each event.
		const lastTick = Math.max(...ticks);
		let currentTick = 0;
		let currentTimeSignature = tempoMap.get(currentTick).timeSignature;
		let meas = 1;
		while (currentTick <= lastTick) {
			// Sets the current time signature if meta event is at the beginning of this measure.
			const obj = tempoMap.get(currentTick);
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
			const keys = [...tempoMap.keys()].filter((tick) => (currentTick <= tick && tick < currentTick + measureTick));
			for (const tick of keys) {
				Object.assign(tempoMap.get(tick), {mbt: {
					meas,
					beat: Math.trunc((tick - currentTick) / beatTick) + 1,
					tick: (tick - currentTick) % beatTick},
				});

				// Sets the current time signature if meta event is in the middle of this measure.
				if (tempoMap.get(tick).timeSignature) {
					currentTimeSignature = tempoMap.get(tick).timeSignature;
				}
			}

			currentTick += measureTick;
			meas++;
		}

		// Adds elapsed time to each event.
		let baseTick = 0;
		let baseObj = tempoMap.get(baseTick);
		baseObj.usec = 0;
		for (const [tick, obj] of tempoMap.entries()) {
			obj.usec = baseObj.usec + (tick - baseTick) * baseObj.usecPerBeat / division;

			if (obj.usecPerBeat) {
				baseTick = tick;
				baseObj = tempoMap.get(baseTick);
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
		for (const [tick, obj] of tempoMap) {
			const sec = Math.trunc(tick / tickPerSec);
			Object.assign(obj, {
				smpte: {
					hours:            Math.trunc(sec / 60 / 60),
					minutes:          Math.trunc(sec / 60) % 60,
					seconds:          sec % 60,
					frames:           Math.trunc((tick % tickPerSec) / subFrameRate),
					fractionalFrames: tick % subFrameRate,
				},
				usec: tick * 1000 * 1000 / tickPerSec,
			});
		}
	}

	return tempoMap;
}
