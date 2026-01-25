require('dotenv').config();
const companyScraperService = require('./src/services/companyScraperService');

async function scrapeCompanies() {
  console.log('Starting scrape for all companies...');
  console.log('This will scrape company websites for professional contacts.\n');

  try {
    const result = await companyScraperService.scrapeAllPending(50);
    console.log('\n========== SCRAPE COMPLETE ==========');
    console.log('Companies scraped:', result.scraped);
    console.log('Total contacts found:', result.totalContacts);
    console.log('Errors:', result.errors.length);
    if (result.errors.length > 0) {
      console.log('Error details:', JSON.stringify(result.errors, null, 2));
    }
  } catch (error) {
    console.error('Scrape failed:', error.message);
  }
}

scrapeCompanies();
