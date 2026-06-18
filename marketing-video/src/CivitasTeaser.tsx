import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJBM } from '@remotion/google-fonts/JetBrainsMono';
import { theme } from './theme';
import { Opener } from './scenes/Opener';
import { Pivot } from './scenes/Pivot';
import { ProofA } from './scenes/ProofA';
import { ProofB } from './scenes/ProofB';
import { ProofC } from './scenes/ProofC';
import { Metrics } from './scenes/Metrics';
import { CTA } from './scenes/CTA';

loadInter('normal', { subsets: ['latin'], weights: ['400', '600', '700', '800'] });
loadJBM('normal', { subsets: ['latin'], weights: ['400', '500', '700'] });

const BgTone: React.FC = () => {
  // Fade in / out of bg drone, and duck slightly during the loudest hits
  // (pivot impact @ 240 and CTA impact @ 840) so SFX punch through.
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [870, 900], [1, 0], { extrapolateLeft: 'clamp' });
  const duckPivot = interpolate(frame, [235, 245, 270, 290], [1, 0.55, 0.55, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const duckCta = interpolate(frame, [835, 845, 870, 895], [1, 0.5, 0.5, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const vol = 0.32 * fadeIn * fadeOut * duckPivot * duckCta;
  return <Audio src={staticFile('audio/bg-tone.wav')} volume={vol} />;
};

export const CivitasTeaser: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: 'Inter' }}>
      {/* ---------- VISUAL SCENES ---------- */}
      <Sequence from={0} durationInFrames={240}>
        <Opener />
      </Sequence>
      <Sequence from={240} durationInFrames={90}>
        <Pivot />
      </Sequence>
      <Sequence from={330} durationInFrames={180}>
        <ProofA />
      </Sequence>
      <Sequence from={510} durationInFrames={120}>
        <ProofB />
      </Sequence>
      <Sequence from={630} durationInFrames={120}>
        <ProofC />
      </Sequence>
      <Sequence from={750} durationInFrames={90}>
        <Metrics />
      </Sequence>
      <Sequence from={840} durationInFrames={60}>
        <CTA />
      </Sequence>

      {/* ---------- AUDIO ---------- */}
      {/* Continuous background drone, ducked under big hits */}
      <BgTone />

      {/* Opener: 8s rising swell, plays for the full opener scene */}
      <Sequence from={0} durationInFrames={240}>
        <Audio src={staticFile('audio/opener-rise.wav')} volume={0.7} />
      </Sequence>

      {/* Pivot: big stinger at the cut to the "but" moment */}
      <Sequence from={240} durationInFrames={90}>
        <Audio src={staticFile('audio/pivot-impact.wav')} volume={0.9} />
      </Sequence>

      {/* ProofA: tech click at scene entry */}
      <Sequence from={330} durationInFrames={60}>
        <Audio src={staticFile('audio/proof-a.wav')} volume={0.75} />
      </Sequence>

      {/* ProofB: arpeggio at scene entry */}
      <Sequence from={510} durationInFrames={60}>
        <Audio src={staticFile('audio/proof-b.wav')} volume={0.75} />
      </Sequence>

      {/* ProofC: sweep + pop at scene entry */}
      <Sequence from={630} durationInFrames={60}>
        <Audio src={staticFile('audio/proof-c.wav')} volume={0.75} />
      </Sequence>

      {/* Metrics: rising arpeggio across the metrics reveal */}
      <Sequence from={750} durationInFrames={90}>
        <Audio src={staticFile('audio/metrics-ping.wav')} volume={0.8} />
      </Sequence>

      {/* CTA: final riser + impact, with slight pre-roll into the last beat */}
      <Sequence from={820} durationInFrames={80}>
        <Audio src={staticFile('audio/cta-impact.wav')} volume={0.95} />
      </Sequence>

      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
