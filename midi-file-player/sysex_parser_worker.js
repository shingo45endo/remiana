import {analyzeMidiMessage} from '../midiana/lib/event-analyzer/midi_event.js';
import {analyzeSysExParams} from '../midiana/lib/event-analyzer/param.js';

let queueItems = [];

self.addEventListener('message', (e) => {
	console.assert(Array.isArray(e.data));

	for (const bytes of e.data) {
		const mes = analyzeMidiMessage(bytes);
		const params = analyzeSysExParams(mes) ?? [];
		queueItems.push({mes, params});
	}
});

setInterval(() => {
	if (queueItems.length > 0) {
		self.postMessage(queueItems);
		queueItems = [];
	}
}, 100);
