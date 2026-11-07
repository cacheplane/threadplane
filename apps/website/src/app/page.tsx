import { Hero } from '../components/landing/Hero';
import { Capabilities } from '../components/landing/Capabilities';
import { Compatibility } from '../components/landing/Compatibility';
import { HomeArchitecture } from '../components/landing/HomeArchitecture';
import { HomeOwnership } from '../components/landing/HomeOwnership';
import { TeamsBlock } from '../components/landing/TeamsBlock';
import { HomeFAQ } from '../components/landing/HomeFAQ';
import { RecentArticles } from '../components/landing/RecentArticles';
import '../styles/homepage.css';
import {
  createPageMetadata,
  HOME_DESCRIPTION,
  HOME_TITLE,
} from '../lib/site-metadata';
import { getFormPolicy } from '../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  pathname: '/',
  type: 'website',
});

export default function HomePage() {
  const formPolicy = getFormPolicy();

  return (
    <div className="home-page">
      <Hero />
      <Capabilities />
      <Compatibility />
      <HomeArchitecture />
      <HomeOwnership />

      <TeamsBlock formPolicy={formPolicy} />
      <HomeFAQ />
      <RecentArticles />
    </div>
  );
}
