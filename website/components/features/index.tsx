import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';
import indexStyles from '../../pages/index.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Generative Storytelling',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
        Transform text prompts into complete cinematic narratives with AI-powered
        story generation, scene breakdowns, and visual descriptions.
      </>
    ),
  },
  {
    title: 'Visual Production',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
        Generate high-quality visuals for each scene using state-of-the-art
        image generation models, bringing your stories to life frame by frame.
      </>
    ),
  },
  {
    title: 'Automated Rendering',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        Seamlessly compile scenes into polished video sequences with motion,
        transitions, and audio, creating cinema-ready content.
      </>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem) {
  return (
    <div className={ clsx('col col--4') }>
      <div className="glass-card" style={ { height: '100%', display: 'flex', flexDirection: 'column' } }>
        <div className="text--center">
          <Svg className={ styles.featureSvg } role="img" />
        </div>
        <div className="text--center padding-horiz--md">
          <Heading as="h2" className={ indexStyles.h2Title }>{ title }</Heading>
          <p style={ { color: 'var(--cc-muted-foreground)' } }>{ description }</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={ styles.features }>
      <div className="container">
        <div className="row">
          { FeatureList.map((props, idx) => (
            <Feature key={ idx } { ...props } />
          )) }
        </div>
      </div>
    </section>
  );
}
