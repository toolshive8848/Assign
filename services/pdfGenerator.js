const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * PDFGenerator class for creating PDF exports of research data using Puppeteer
 * Supports research reports, citations, and bibliographies
 */
class PDFGenerator {
  constructor() {
    this.defaultOptions = {
      format: 'A4',
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      },
      printBackground: true
    };
  }

  /**
   * Generate PDF for research report
   * @param {Object} research - Research data
   * @param {Object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateResearchPDF(research, options = {}) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      const html = this.generateResearchHTML(research);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfOptions = { ...this.defaultOptions, ...options };
      const pdfBuffer = await page.pdf(pdfOptions);
      
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  /**
   * Generate PDF for citations
   * @param {Object} citations - Citations data
   * @param {Object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateCitationsPDF(citations, options = {}) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      const html = this.generateCitationsHTML(citations);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfOptions = { ...this.defaultOptions, ...options };
      const pdfBuffer = await page.pdf(pdfOptions);
      
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  /**
  /**
 * Generate PDF for bibliography
 * @param {Object} citations - Citations data (from CitationGenerator)
 * @param {Object} options - PDF generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
async generateBibliographyPDF(citations, options = {}) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const html = this.generateBibliographyHTML(citations);
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfOptions = { ...this.defaultOptions, ...options };
    const pdfBuffer = await page.pdf(pdfOptions);

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

  /**
  /**
 * Generate HTML for research report
 * @param {Object} results - Research results object (from research.results)
 * @returns {string} HTML content
 */
generateResearchHTML(results) {
  const metadata = this.getPDFMetadata(results);

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Research Report</title>
    <style>
      body {
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
        color: #333;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
        border-bottom: 2px solid #333;
        padding-bottom: 20px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .metadata {
        font-size: 12px;
        color: #666;
        margin-bottom: 20px;
      }
      .section {
        margin-bottom: 25px;
      }
      .section-title {
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 10px;
        color: #2c3e50;
        border-bottom: 1px solid #bdc3c7;
        padding-bottom: 5px;
      }
      .query-box {
        background-color: #f8f9fa;
        border-left: 4px solid #007bff;
        padding: 15px;
        margin: 15px 0;
        font-style: italic;
      }
      .results {
        text-align: justify;
        margin: 15px 0;
      }
      .sources {
        margin-top: 20px;
      }
      .source-item {
        margin-bottom: 15px;
        padding: 10px;
        background-color: #f8f9fa;
        border-radius: 5px;
      }
      .source-title {
        font-weight: bold;
        color: #2c3e50;
      }
      .source-url {
        color: #007bff;
        font-size: 12px;
        word-break: break-all;
      }
      .stats {
        display: flex;
        justify-content: space-between;
        background-color: #e9ecef;
        padding: 15px;
        border-radius: 5px;
        margin: 20px 0;
      }
      .stat-item {
        text-align: center;
      }
      .stat-value {
        font-size: 18px;
        font-weight: bold;
        color: #2c3e50;
      }
      .stat-label {
        font-size: 12px;
        color: #6c757d;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">Research Report</div>
      <div class="metadata">
        Generated: ${metadata.generatedDate}<br>
        Word Count: ${results.wordCount || 0} words
      </div>
    </div>

    <div class="section">
      <div class="section-title">Research Query</div>
      <div class="query-box">
        ${results.query || 'No query specified'}
      </div>
    </div>

    ${results.summary ? `
    <div class="section">
      <div class="section-title">Executive Summary</div>
      <div class="results">${results.summary}</div>
    </div>
    ` : ''}

    ${results.findings ? `
    <div class="section">
      <div class="section-title">Key Findings</div>
      <div class="results">${results.findings}</div>
    </div>
    ` : ''}

    ${results.insights ? `
    <div class="section">
      <div class="section-title">Insights</div>
      <div class="results">${results.insights}</div>
    </div>
    ` : ''}

    ${results.analysis ? `
    <div class="section">
      <div class="section-title">Analysis</div>
      <div class="results">${results.analysis}</div>
    </div>
    ` : ''}

    ${results.sources && results.sources.length > 0 ? `
    <div class="section">
      <div class="section-title">Sources (${results.sources.length})</div>
      <div class="sources">
        ${results.sources.map((source, index) => `
          <div class="source-item">
            <div class="source-title">${index + 1}. ${source.title || 'Untitled'}</div>
            <div class="source-url">${source.url || 'No URL'}</div>
            ${source.type ? `<div><strong>Type:</strong> ${source.type}</div>` : ''}
            ${source.reliability ? `<div><strong>Reliability:</strong> ${source.reliability}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="stats">
      <div class="stat-item">
        <div class="stat-value">${results.sources?.length || 0}</div>
        <div class="stat-label">Sources</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${results.wordCount || 0}</div>
        <div class="stat-label">Words</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${results.qualityScore || 'N/A'}</div>
        <div class="stat-label">Quality Score</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${results.creditsUsed || 0}</div>
        <div class="stat-label">Credits Used</div>
      </div>
    </div>
  </body>
  </html>
  `;
}

  /**
   /**
 * Generate HTML for citations
 * @param {Object} citations - Citations data (from CitationGenerator)
 * @returns {string} HTML content
 */
generateCitationsHTML(citations) {
  const entries = citations?.formattedBibliography?.entries || [];
  const header = citations?.formattedBibliography?.header || 'References';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Research Citations</title>
    <style>
      body {
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
        color: #333;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
        border-bottom: 2px solid #333;
        padding-bottom: 20px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .citation-style {
        font-size: 14px;
        color: #666;
        margin-bottom: 20px;
      }
      .citation-item {
        margin-bottom: 15px;
        padding: 12px;
        background-color: #f8f9fa;
        border-left: 4px solid #007bff;
        text-align: justify;
      }
      .citation-number {
        font-weight: bold;
        color: #2c3e50;
        margin-right: 6px;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">${header}</div>
      <div class="citation-style">
        Citation Style: ${citations.style?.toUpperCase() || 'APA'}<br>
        Generated: ${new Date().toLocaleString()}
      </div>
    </div>

    ${entries.length > 0 ? `
      <div>
        ${entries.map((entry, index) => `
          <div class="citation-item">
            <span class="citation-number">${index + 1}.</span>
            ${entry}
          </div>
        `).join('')}
      </div>
    ` : `
      <p>No citations available.</p>
    `}
  </body>
  </html>
  `;
}

  /**
/**
 * Generate HTML for bibliography
 * @param {Object} citations - Citations data (from CitationGenerator)
 * @returns {string} HTML content
 */
generateBibliographyHTML(citations) {
  const entries = citations?.formattedBibliography?.entries || [];
  const header = citations?.formattedBibliography?.header || 'Bibliography';
  const style = citations?.style?.toUpperCase() || 'APA';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${header}</title>
    <style>
      body {
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
        color: #333;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
        border-bottom: 2px solid #333;
        padding-bottom: 20px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .style-info {
        font-size: 14px;
        color: #666;
        margin-bottom: 20px;
      }
      .bib-entry {
        margin-bottom: 15px;
        padding: 12px;
        background-color: #f8f9fa;
        border-left: 4px solid #28a745;
        text-align: justify;
      }
      .entry-number {
        font-weight: bold;
        color: #2c3e50;
        margin-right: 6px;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">${header}</div>
      <div class="style-info">
        Citation Style: ${style}<br>
        Total Sources: ${entries.length}<br>
        Generated: ${new Date().toLocaleString()}
      </div>
    </div>

    ${entries.length > 0 ? `
      <div>
        ${entries.map((entry, index) => `
          <div class="bib-entry">
            <span class="entry-number">${index + 1}.</span>
            ${entry}
          </div>
        `).join('')}
      </div>
    ` : '<p>No bibliography entries available.</p>'}
  </body>
  </html>
  `;
}

  /**
   * Get PDF metadata
   * @param {Object} research - Research data
   * @returns {Object} Metadata object
   */
  getPDFMetadata(research) {
    return {
      title: `Research Report - ${research.query || 'Untitled'}`,
      author: 'Assignment Writer Platform',
      subject: 'Academic Research Report',
      creator: 'Research Tool',
      generatedDate: new Date().toLocaleString(),
      wordCount: research.wordCount || 0,
      sourceCount: research.sources?.length || 0
    };
  }
}

module.exports = PDFGenerator;
