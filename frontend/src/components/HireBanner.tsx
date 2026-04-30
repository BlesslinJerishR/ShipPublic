import styles from './HireBanner.module.css';

export default function HireBanner() {
  return (
    <div className={styles.banner} role="complementary" aria-label="Hire blessl.in">
      <a href="https://blessl.in" target="_blank" rel="noopener noreferrer">Hire blessl.in</a>
      {' '}for $3000 USD
    </div>
  );
}
