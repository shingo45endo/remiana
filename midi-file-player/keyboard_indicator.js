const KEY_WIDTH  =  8;
const KEY_HEIGHT = 24;
const SHARP_WIDTH_RATE  = 10 / 16;
const SHARP_HEIGHT_RATE = 11 / 16;

const elemSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
elemSvg.setAttribute('viewBox', `0 0 ${KEY_WIDTH * 75} ${KEY_HEIGHT}`);
elemSvg.innerHTML = `
<style type="text/css">
:host {
	display: block;
	width: 100%;
	line-height: 0;

	--active-color-hue: 215;	/* Default color hue */
}

rect {
	stroke: currentColor;
	stroke-opacity: 0.25;
}
rect.active {
	animation: note-on 0.5s ease-out both;
}

@keyframes note-on {
	0% {
		fill: hsl(var(--active-color-hue), 100%, 67%);
		stroke-color: hsl(var(--active-color-hue), 67%, 50%);
	}
	100% {
		fill: hsl(var(--active-color-hue), 67%, 50%);
		stroke-color: currentColor;
	}
}
</style>
<defs>
	<linearGradient id="gradient-white-base" gradientTransform="rotate(90)">
		<stop stop-color="currentColor" stop-opacity="0.25" offset="0%" />
		<stop stop-color="currentColor" stop-opacity="0" offset="100%" />
	</linearGradient>
	<linearGradient id="gradient-black-base" gradientTransform="rotate(90)">
		<stop stop-color="currentColor" stop-opacity="0.875" offset="0%" />
		<stop stop-color="currentColor" stop-opacity="1" offset="100%" />
	</linearGradient>
</defs>
${makeKeyStr()}`;

function makeKeyStr() {
	let str = '';

	const offsets = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
	for (let i = 0; i < 128; i++) {
		if (offsets[i % offsets.length] % 2 === 0) {
			const offsetX = 7 * Math.trunc(i / 12) + offsets[i % offsets.length] / 2;
			str += `<rect id="note${i}" class="white" x="${KEY_WIDTH * offsetX}" y="0" width="${KEY_WIDTH}" height="${KEY_HEIGHT}" fill="url(#gradient-white-base)" />`;
		}
	}
	for (let i = 0; i < 128; i++) {
		if (offsets[i % offsets.length] % 2 !== 0) {
			const offsetX = 7 * Math.trunc(i / 12) + offsets[i % offsets.length] / 2;
			str += `<rect id="note${i}" class="black" x="${KEY_WIDTH * offsetX + (KEY_WIDTH * (1 - SHARP_WIDTH_RATE) / 2)}" y="0" width="${KEY_WIDTH * SHARP_WIDTH_RATE}" height="${KEY_HEIGHT * SHARP_HEIGHT_RATE}" fill="url(#gradient-black-base)" />`;
		}
	}

	return str;
}

export class KeyboardIndicator extends HTMLElement {
	constructor() {
		super();

		this._elemSvg = elemSvg.cloneNode(true);
		this._elemKeys = [...this._elemSvg.querySelectorAll('rect[id^=note]')].sort((a, b) => Number(a.id.match(/\d+/u)) - Number(b.id.match(/\d+/u)));
		console.assert(this._elemKeys.length === 128);

		// Creates and attaches the shadow root.
		this._shadowRoot = this.attachShadow({mode: 'open'});
		this._shadowRoot.append(this._elemSvg);
	}

	reset() {
		this.noteOff([...new Array(128)].map((_, i) => i));
	}

	noteOn(noteNo) {
		const noteNos = (Number.isInteger(noteNo)) ? [noteNo] : noteNo;
		console.assert(noteNos.every((e) => (0 <= e && e < 128)));
		for (const noteNo of noteNos) {
			this._elemKeys[noteNo].classList.add('active');
		}
	}

	noteOff(noteNo) {
		const noteNos = (Number.isInteger(noteNo)) ? [noteNo] : noteNo;
		console.assert(noteNos.every((e) => (0 <= e && e < 128)));
		for (const noteNo of noteNos) {
			this._elemKeys[noteNo].classList.remove('active');
		}
	}
}

window.customElements.define('keyboard-indicator', KeyboardIndicator);
