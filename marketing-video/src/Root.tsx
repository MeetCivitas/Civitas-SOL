import React from 'react';
import { Composition } from 'remotion';
import { CivitasTeaser } from './CivitasTeaser';

export const Root: React.FC = () => {
  return (
    <Composition
      id="CivitasTeaser"
      component={CivitasTeaser}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
