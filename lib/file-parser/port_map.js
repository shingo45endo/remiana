export function makePortMap(song) {
	console.assert(song && song.MThd && song.MTrks);

	// SMF format 0 contains only 1 track and it is for Port-A.
	if (song.MThd.format === 0) {
		return [0];
	}

	// Analyzes each track's information regarding port No.
	const deviceNameMap = new Map();
	const portInfo = song.MTrks.map((mtrk) => {
		console.assert(Array.isArray(mtrk.events));
		const obj = {};
		for (const event of mtrk.events) {
			const {tick, bytes} = event;

			if (tick > 0) {
				break;
			}

			if (bytes[0] === 0xff) {
				// Port Prefix meta event (unofficial)
				if (bytes[1] === 0x21 && bytes.length === 4) {
					obj.unofficialPortPrefix = bytes[3];
				}
				// Yamaha Sequencer-Specific MIDI Port Prefix meta event (undocumented?)
				if (bytes[1] === 0x7f && bytes[2] === 0x04 && bytes[3] === 0x43 && bytes[4] === 0x00 && bytes[5] === 0x01) {
					obj.yamahaPortPrefix = bytes[6];
				}
				// Device Name meta event (Not used to determine port No. at this moment)
				if (bytes[1] === 0x08) {
					const index = event.bytes.findIndex((e, i) => (i >= 2 && (e & 0x80) === 0)) + 1;
					if (index >= 3) {
						const deviceName = bytes.slice(index).map((e) => (0x20 <= e && e < 0x7f) ? String.fromCharCode(e) : `\\x${e.toString(16).padStart(2, '0')}`).join('');
						if (!deviceNameMap.has(deviceName)) {
							deviceNameMap.set(deviceName, deviceNameMap.size);
						}
						obj.deviceName = deviceName;
						obj.deviceNameIndex = deviceNameMap.get(deviceName);
					}
				}
			}
		}
		return obj;
	});

	// Determines each track's port No.
	const keys = portInfo.map((e) => Object.keys(e)).flat();
	let portNos = [...new Array(song.MTrks.length)].fill(0);
	if (keys.includes('yamahaPortPrefix')) {
		portNos = portInfo.map((e) => e.yamahaPortPrefix ?? 0);

	} else if (keys.includes('unofficialPortPrefix')) {
		portNos = portInfo.map((e) => e.unofficialPortPrefix ?? 0);

		// If the Port No.0 is not used by any part, shifts (minus 1) all the port No.
		// Note 1: Some SMFs which were converted by Recomposer .RCP format might have the port number of all tracks specified as "1" (Port-B).
		// As for the internal representation of Recomposer channel No., originally, 1 to 16 are used for MPU-401 and 17-32 are used for RS-MIDI.
		// After Recomposer supports Super MPU, a multi-port MIDI interface, channel No. 17-32 are used for Port-B.
		// So, such kind of SMFs should be treated as "16-channel MIDI file authored in RS-MIDI environment" rather than "32-channel MIDI file but only used Port-B".
		// Note 2: It is said that there are a very few SMFs which the unofficial Port Prefix meta events are used as below:
		//   0: Mute, 1: Port-A, 2: Port-B, ...
		// In this case, since "0" is rarely specified, so it makes sense to "shift" all the port No.
		if (!portInfo.map((e) => e.unofficialPortPrefix).includes(0)) {
			portNos = portNos.map((portNo) => Math.max(portNo - 1, 0));
		}

	} else {
		// TODO: Implement
	}

	return {portNos, portInfo};
}
