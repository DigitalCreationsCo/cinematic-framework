import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Generative Storytelling',
    description: (
      <>
        Transform text prompts into complete cinematic narratives with AI-powered
        story generation, scene breakdowns, and visual descriptions.
      </>
    ),
  },
  {
    title: 'Visual Production',
    description: (
      <>
        Generate high-quality visuals for each scene using state-of-the-art
        image generation models, bringing your stories to life frame by frame.
      </>
    ),
  },
  {
    title: 'Automated Rendering',
    description: (
      <>
        Seamlessly compile scenes into polished video sequences with motion,
        transitions, and audio, creating cinema-ready content.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={ clsx('col col--4') }>
      <div className="glass-card" style={ { height: '100%', display: 'flex', flexDirection: 'column', padding: '1rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem' } }>
        <div className="text--center padding-horiz--md">
          <h2 className="text-xl font-bold mb-2">{ title }</h2>
          <p style={ { color: 'var(--cc-muted-foreground)' } }>{ description }</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={ styles.features }>
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap -mx-4">
          { FeatureList.map((props, idx) => (
            <Feature key={ idx } { ...props } />
          )) }
        </div>
      </div>
    </section>
  );
}
