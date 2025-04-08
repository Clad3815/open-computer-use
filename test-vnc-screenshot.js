import puppeteer from 'puppeteer';

(async () => {
  let browser = null;
  try {
    console.log('Lancement du navigateur...');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1280, height: 720 },
      headless: "new",
    });

    console.log('Création d\'une nouvelle page...');
    const page = await browser.newPage();
    
    const url = 'http://localhost:8006/vnc.html?view_only=1&autoconnect=1&resize=scale';
    console.log(`Navigation vers ${url}...`);
    
    const response = await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 // 30 secondes de timeout
    });

    if (!response) {
      throw new Error('Pas de réponse du serveur');
    }

    const status = response.status();
    console.log(`Statut de la réponse: ${status}`);

    if (status !== 200) {
      throw new Error(`Statut HTTP invalide: ${status}`);
    }

    console.log('Prise de la capture d\'écran...');
    await page.screenshot({ path: 'screenshot.png' });
    console.log('Capture d\'écran sauvegardée avec succès');

  } catch (error) {
    console.error('Une erreur est survenue:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      console.log('Fermeture du navigateur...');
      await browser.close();
    }
  }
})();
