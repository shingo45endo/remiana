import {makeWarn} from './chunk_parser.js';

// v000: YAMAHA MU Sampling Extension
export function parseV000(buf, tag, parentTags = [], logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'v000');

	const tagPath = parentTags.join('/');
	if (tagPath.endsWith('ins /YMHM/MU00')) {	// Tone parameter
		if (buf.byteLength < 358) {
			logs.push(makeWarn(`Unexpected content of ${tag} chunk in 'ins' chunk`, buf));
			return null;
		}

		const voiceName = String.fromCharCode(...buf.subarray(10, 10 + 8));
		const elements = [];
		for (let i = 22; i < 358; i += 84) {
			const param = buf.subarray(i, i + 84);
			elements.push({
				waveNo:                    (param[0] << 7) | param[1],
				noteLimitLow:              param[2],
				noteLimitHigh:             param[3],
				velocityLimitLow:          param[4],
				velocityLimitHigh:         param[5],
				filterCurve:               param[6],
				lfoWave:                   param[7],
				lfoPhaseShift:             param[8],
				lfoSpeed:                  param[9],
				pLfoDelay:                 param[10],
				pLfoFadeTime:              param[11],
				lfoPMod:                   param[12],
				lfoFMod:                   param[13],
				lfoAMod:                   param[14],
				noteShift:                 param[15],
				detune:                    param[16],
				pitchScalingRate:          param[17],
				pitchScalingCenter:        param[18],
				pitchEgDepth:              param[19],
				pegDepthLevelVelSens:      param[20],
				pegDepthRateVelSens:       param[21],
				pegDepthRateScaling:       param[22],
				pegDepthRateScalCenter:    param[23],
				pegAttackRate:             param[24],
				pegDecay1Rate:             param[25],
				pegDecay2Rate:             param[26],
				pegReleaseRate:            param[27],
				pegInitialLevel:           param[28],
				pegAttackLevel:            param[29],
				pegDecay1Level:            param[30],
				pegDecay2Level:            param[31],
				pegReleaseLevel:           param[32],
				filterResonance:           param[33],
				ampVelocitySens:           param[34],
				filterCutoffFreq:          param[35],
				filterScalingBp1:          param[36],
				filterScalingBp2:          param[37],
				filterScalingBp3:          param[38],
				filterScalingBp4:          param[39],
				filterScalingOffset1:      param[40],
				filterScalingOffset2:      param[41],
				filterScalingOffset3:      param[42],
				filterScalingOffset4:      param[43],
				fegLevelVelocitySens:      param[44],
				fegRateVelocitySens:       param[45],
				fegRateScaling:            param[46],
				fegRateScalingCenter:      param[47],
				fegAttackRate:             param[48],
				fegDecay1Rate:             param[49],
				fegDecay2Rate:             param[50],
				fegReleaseRate:            param[51],
				fegInitialLevel:           param[52],
				fegAttackLevel:            param[53],
				fegDecay1Level:            param[54],
				fegDecay2Level:            param[55],
				fegReleaseLevel:           param[56],
				elementVolume:             param[57],
				levelScalingBp1:           param[58],
				levelScalingBp2:           param[59],
				levelScalingBp3:           param[60],
				levelScalingBp4:           param[61],
				levelScalingOffset1:       param[62],
				levelScalingOffset2:       param[63],
				levelScalingOffset3:       param[64],
				levelScalingOffset4:       param[65],
				velocityCurve:             param[66],
				pan:                       param[67],
				aegRateScaling:            param[68],
				aegRateScalingCenter:      param[69],
				aegKeyOnDelay:             param[70],
				aegAttackRate:             param[71],
				aegDecay1Rate:             param[72],
				aegDecay2Rate:             param[73],
				aegReleaseRate:            param[74],
				aegDecay1Level:            param[75],
				aegDecay2Level:            param[76],
				addressOffset:             (param[77] << 7) | param[78],
				resonanceSensitivity:      param[79],
				highPassFilterCutoffFreq:  param[80],
				aegInitialLevel:           param[81],
				fegDepth:                  param[82],
				fegDepthVelSens:           param[83],
			});
		}

		return {voiceName, elements};

	} else if (tagPath.endsWith('rgn /YMHM/MU00')) {	// Drum parameter
		if (buf.byteLength < 50) {
			logs.push(makeWarn(`Unexpected content of ${tag} chunk in 'rgn' chunk`, buf));
			return null;
		}

		const voiceName = String.fromCharCode(...buf.subarray(0, 8));
		const param = buf.subarray(8);
		const drumSetup = {
			pitchCourse:              param[0],
			pitchFine:                param[1],
			volume:                   param[2],
			alternateGroup:           param[3],
			pan:                      param[4],
			reverbSendLevel:          param[5],
			chorusSendLevel:          param[6],
			variationSendLevel:       param[7],
			keyAssign:                param[8],
			receiveNoteOff:           param[9],
			receiveNoteOn:            param[10],
			filterCutoffFrequency:    param[11],
			filterResonance:          param[12],
			egAttackRate:             param[13],
			egDecay1Rate:             param[14],
			egDecay2Rate:             param[15],
			eqBassGain:               param[16],
			eqTrebleGain:             param[17],
			eqBassFrequency:          param[18],
			eqTrebleFrequency:        param[19],
			highPassFilterCutoffFreq: param[20],
			velocitySensPitch:        param[21],
			velocitySensLpfCutoff:    param[22],
			rawByte23:                param[23],
			rawByte24:                param[24],
			rawByte25:                param[25],
			rawByte26:                param[26],
			rawByte27:                param[27],
			rawByte28:                param[28],
			rawByte29:                param[29],
			rawByte30:                param[30],
			rawByte31:                param[31],
			rawByte32:                param[32],
			rawByte33:                param[33],
			rawByte34:                param[34],
			rawByte35:                param[35],
			rawByte36:                param[36],
			rawByte37:                param[37],
			rawByte38:                param[38],
			rawByte39:                param[39],
			rawByte40:                param[40],
			rawByte41:                param[41],
		};

		return {voiceName, drumSetup};
	}

	return null;
}
