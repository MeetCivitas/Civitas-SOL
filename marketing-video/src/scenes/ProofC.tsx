import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { theme } from '../theme';

export const ProofC: React.FC = () => {
  const frame = useCurrentFrame();

  const sceneIn = interpolate(frame, [0, 16], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const sceneOut = interpolate(frame, [108, 120], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const zoom = interpolate(frame, [0, 120], [1.04, 1.1]);

  const labelOpacity = interpolate(frame, [14, 36], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const headlineOpacity = interpolate(frame, [22, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const headlineX = interpolate(frame, [22, 50], [-22, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: sceneIn * sceneOut }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${zoom})`,
        }}
      >
        <Img
          src={staticFile('screenshots/private-payouts.png')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(10,10,15,0.45) 0%, rgba(10,10,15,0.2) 40%, rgba(10,10,15,0.94) 100%)',
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 110,
          left: 110,
          transform: `translateX(${headlineX}px)`,
          maxWidth: 1500,
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 22,
            color: theme.solPurple,
            letterSpacing: 3,
            marginBottom: 22,
            textTransform: 'uppercase',
            opacity: labelOpacity,
          }}
        >
          layer 4 · magicblock private payments
        </div>
        <div
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 80,
            fontWeight: 700,
            color: theme.white,
            letterSpacing: -1.5,
            lineHeight: 1.05,
            opacity: headlineOpacity,
          }}
        >
          split = 5 · delay ∈ [500ms, 30s]
        </div>
      </div>
    </AbsoluteFill>
  );
};
