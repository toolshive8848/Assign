const express = require('express');
const ResearchService = require('./services/researchService');
const ImprovedCreditSystem = require('./services/improvedCreditSystem');
const PlanValidator = require('./services/planValidator');
const PDFGenerator = require('./services/pdfGenerator');
const { unifiedAuth } = require('./middleware/unifiedAuth');
const { asyncErrorHandler } = require('./middleware/errorHandler');
const { validateResearchInput, handleValidationErrors } = require('./middleware/validation');

const router = express.Router();

// Initialize services
const researchService = new ResearchService();
const creditSystem = new ImprovedCreditSystem();
const planValidator = new PlanValidator();
const pdfGenerator = new PDFGenerator();

/**
 * POST /api/research/query
 * Conduct deep research using Gemini 2.5 Pro
 */
router.post('/query', unifiedAuth, validateResearchInput, asyncErrorHandler(async (req, res) => {
  try {
    const { 
      query, 
      researchType = 'general', 
      depth = 3, 
      sources = [],
      saveToHistory = true 
    } = req.body;

    // Input validation
    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Research query is required'
      });
    }

    if (query.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Research query too long. Maximum 2000 characters allowed.'
      });
    }

    if (depth < 1 || depth > 5) {
      return res.status(400).json({
        success: false,
        error: 'Research depth must be between 1 and 5'
      });
    }

    const validResearchTypes = ['general', 'academic', 'technical', 'market', 'scientific', 'historical'];
    if (!validResearchTypes.includes(researchType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid research type. Must be one of: ${validResearchTypes.join(', ')}`
      });
    }

    // Step 1: Estimate research output (research uses 1:10 word-to-credit ratio)
    const estimatedWordCount = Math.min(depth * 1000, 8000); // Estimate based on depth
    const estimatedCredits = researchService.calculateResearchCredits(estimatedWordCount, depth);
    console.log(`Estimated research credits needed: ${estimatedCredits} for ${estimatedWordCount} words at depth ${depth} (1:10 ratio)`);

    // Step 2: Plan validation and input limits
    const planValidation = await planValidator.validateRequest(req.user.id, query, estimatedWordCount, 'research');
    
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode,
        details: {
          planType: planValidation.planType,
          currentUsage: planValidation.currentUsage,
          limits: planValidation.monthlyLimit || planValidation.maxLength || planValidation.maxCount
        }
      });
    }

    // Step 3: credit deduction for research
    const creditDeductionResult = await creditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for research',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits,
          planType: planValidation.userPlan.planType
        }
      });
    }

    // Step 4: Conduct research
    const startTime = Date.now();
    const researchResult = await researchService.conductResearch(
      query,
      researchType,
      depth,
      sources,
      req.user.id
    );
    const processingTime = Date.now() - startTime;

    // Step 5: Calculate actual credits based on output
    const actualCredits = researchService.calculateResearchCredits(researchResult.wordCount, depth);
    
    // Step 6: Adjust credits if actual > estimated (only extra charge, no refunds)
   let finalCreditsUsed = creditDeductionResult.creditsDeducted;
if (actualCredits > estimatedCredits) {
  const creditDifference = actualCredits - estimatedCredits;
  const additionalDeduction = await creditSystem.deductCreditsAtomic(
    req.user.id,
    creditDifference,
    planValidation.userPlan.planType,
    'research'
  );
  if (additionalDeduction.success) {
    finalCreditsUsed += creditDifference;
  }
}

    // Step 7: Save to research history with enhanced data
    let researchId = null;
    if (saveToHistory) {
      researchId = await researchService.saveResearchToHistory(
        req.user.id,
        researchResult.data,
        {
          ...researchResult.metadata,
          processingTime,
          creditsUsed: finalCreditsUsed,
          transactionId: creditDeductionResult.transactionId,
          citations: researchResult.data.citations,
          sourceValidation: researchResult.data.sourceValidation,
          recommendations: researchResult.data.recommendations,
          qualityScore: researchResult.data.qualityScore
        }
      );
    }

    // Step 8: Record usage
    await planValidator.recordUsage(
      req.user.id,
      researchResult.wordCount,
      finalCreditsUsed,
      'research'
    );

    // Step 9: Return research results
    res.json({
      success: true,
      data: {
        researchId,
        query,
        researchType,
        depth,
        results: researchResult.data,
        metadata: {
          wordCount: researchResult.wordCount,
          processingTime,
          creditsUsed: finalCreditsUsed,
          timestamp: new Date().toISOString(),
          sources: researchResult.data.sources || [],
          citations: researchResult.data.citations || [],
          sourceValidation: researchResult.data.sourceValidation || {},
          recommendations: researchResult.data.recommendations || [],
          qualityScore: researchResult.data.qualityScore || 0
        }
      }
    });

  } catch (error) {
    console.error('Research query error:', error);
    
    // Rollback credits on error
    if (creditDeductionResult && creditDeductionResult.success) {
      try {
        await creditSystem.rollbackTransaction(
          req.user.id,
          creditDeductionResult.transactionId,
          creditDeductionResult.creditsDeducted,
          creditDeductionResult.wordsAllocated
        );
      } catch (rollbackError) {
        console.error('Credit rollback failed:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Research generation failed',
      details: error.message
    });
  }
}));

/**
 * GET /api/research/history
 * Get user's research history
 */
router.get('/history', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const parsedLimit = Math.min(parseInt(limit) || 20, 100); // Max 100 items
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);

    const history = await researchService.getResearchHistory(
      req.user.id,
      parsedLimit,
      parsedOffset
    );

    res.json({
      success: true,
      data: {
        history,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          hasMore: history.length === parsedLimit
        }
      }
    });

  } catch (error) {
    console.error('Research history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research history',
      details: error.message
    });
  }
}));

/**
 * GET /api/research/:id
 * Get specific research by ID
 */
router.get('/:id', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Research ID is required'
      });
    }

    const research = await researchService.getResearchById(id, req.user.id);

    res.json({
      success: true,
      data: research
    });

  } catch (error) {
    console.error('Get research error:', error);
    
    if (error.message === 'Research not found') {
      return res.status(404).json({
        success: false,
        error: 'Research not found'
      });
    }
    
    if (error.message === 'Unauthorized access to research') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access to research'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch research',
      details: error.message
    });
  }
}));

/**
 * DELETE /api/research/:id
 * Delete specific research from history
 */
router.delete('/:id', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Research ID is required'
      });
    }

    // First verify ownership
    const research = await researchService.getResearchById(id, req.user.id);
    
    // Delete the research
    await researchService.db.collection('research_history').doc(id).delete();

    res.json({
      success: true,
      message: 'Research deleted successfully'
    });

  } catch (error) {
    console.error('Delete research error:', error);
    
    if (error.message === 'Research not found') {
      return res.status(404).json({
        success: false,
        error: 'Research not found'
      });
    }
    
    if (error.message === 'Unauthorized access to research') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access to research'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete research',
      details: error.message
    });
  }
}));

/**
 * POST /api/research/export/:id
 // Export research in different formats
router.post('/export/:id', requireAuth, asyncErrorHandler(async (req, res) => {
  const { id } = req.params;
  const { format } = req.body;

  // Fetch research
  const research = await researchService.getResearchById(id, req.user.id);
  const results = research.results || research.data || {}; // fallback for old records

  let exportData;
  let contentType;
  let filename;

  switch (format) {
    case 'json':
      exportData = JSON.stringify(results, null, 2);
      contentType = 'application/json';
      filename = `research-${id}.json`;
      break;

    case 'txt':
      exportData = formatAsText(results);
      contentType = 'text/plain';
      filename = `research-${id}.txt`;
      break;

    case 'markdown':
      exportData = formatAsMarkdown(results);
      contentType = 'text/markdown';
      filename = `research-${id}.md`;
      break;

    case 'citations':
      if (results.citations) {
        exportData = formatCitations(results);
        contentType = 'text/plain';
        filename = `research-citations-${id}.txt`;
      } else {
        return res.status(400).json({ success: false, error: 'No citations available' });
      }
      break;

    case 'bibliography':
      if (results.citations) {
        exportData = formatBibliography(results);
        contentType = 'text/plain';
        filename = `research-bibliography-${id}.txt`;
      } else {
        return res.status(400).json({ success: false, error: 'No bibliography available' });
      }
      break;

    case 'pdf':
      exportData = await pdfGenerator.generateResearchPDF(results);
      contentType = 'application/pdf';
      filename = `research-report-${id}.pdf`;
      break;

    case 'pdf-citations':
      if (results.citations) {
        exportData = await pdfGenerator.generateCitationsPDF(results.citations);
      } else {
        return res.status(400).json({ success: false, error: 'No citations available' });
      }
      contentType = 'application/pdf';
      filename = `research-citations-${id}.pdf`;
      break;

    case 'pdf-bibliography':
      if (results.citations) {
        exportData = await pdfGenerator.generateBibliographyPDF(results.citations);
      } else {
        return res.status(400).json({ success: false, error: 'No bibliography available' });
      }
      contentType = 'application/pdf';
      filename = `research-bibliography-${id}.pdf`;
      break;

    default:
      return res.status(400).json({ success: false, error: 'Unsupported export format' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(exportData);
}));

/**
 * Helper function to format research as plain text
 */
function formatAsText(research) {
  const results = research.results || research.data || {};
 let text = `Research Query: ${research.query}\n`;
  text += `Research Type: ${research.researchType}\n`;
  text += `Depth Level: ${research.depth}\n`;
  text += `Date: ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  if (results.executiveSummary) {
    text += `EXECUTIVE SUMMARY\n${'-'.repeat(50)}\n${results.executiveSummary}\n\n`;
  }
  
  if (results.mainFindings) {
    text += `MAIN FINDINGS\n${'-'.repeat(50)}\n${results.mainFindings}\n\n`;
  }
  
  if (results.keyInsights) {
    text += `KEY INSIGHTS\n${'-'.repeat(50)}\n${results.keyInsights}\n\n`;
  }
  
  if (results.recommendations) {
    text += `RECOMMENDATIONS\n${'-'.repeat(50)}\n${results.recommendations}\n\n`;
  }
  
  if (results.sources && results.sources.length > 0) {
    text += `SOURCES\n${'-'.repeat(50)}\n`;
    results.sources.forEach((source, index) => {
      text += `${index + 1}. ${source.citation}\n`;
    });
  }
  
  return text;
}

/**
 * Helper function to format research as markdown
 */
function formatAsMarkdown(research) {
  const results = research.results;
  let markdown = `# Research Report\n\n`;
  markdown += `**Query:** ${research.query}\n\n`;
  markdown += `**Type:** ${research.researchType}\n\n`;
  markdown += `**Depth:** ${research.depth}/5\n\n`;
  markdown += `**Date:** ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  if (results.executiveSummary) {
    markdown += `## Executive Summary\n\n${results.executiveSummary}\n\n`;
  }
  
  if (results.mainFindings) {
    markdown += `## Main Findings\n\n${results.mainFindings}\n\n`;
  }
  
  if (results.keyInsights) {
    markdown += `## Key Insights\n\n${results.keyInsights}\n\n`;
  }
  
  if (results.recommendations) {
    markdown += `## Recommendations\n\n${results.recommendations}\n\n`;
  }
  
  if (results.sources && results.sources.length > 0) {
    markdown += `## Sources\n\n`;
    results.sources.forEach((source, index) => {
      markdown += `${index + 1}. ${source.citation}\n`;
    });
  }
  
  return markdown;
}

/**
 * Helper function to format citations only
 */
function formatCitations(research) {
 const results = research.results || research.data || {};
let citations = `Citations for Research: ${research.query}\n`;
  citations += `Generated on: ${new Date(research.timestamp.toDate()).toLocaleDateString()}\n\n`;
  
  const results = research.results || research.data || {};
if (results.sources && results.sources.length > 0) {
  results.sources.forEach((source, index) => {
    bibliography += `${index + 1}. `;
    
    if (source.citation) {
      bibliography += source.citation;
    } else {
  
      // fallback
    citations += 'No sources found in this research.\n';
  }
  
  return citations;
}

/**
 * Helper function to format bibliography
 */
function formatBibliography(research) {
  let bibliography = 'BIBLIOGRAPHY\n';
  bibliography += '='.repeat(50) + '\n\n';
  
  if (research.citations && research.citations.style) {
    bibliography += `Citation Style: ${research.citations.style.toUpperCase()}\n\n`;
  }
  
  if (research.sources && research.sources.length > 0) {
    research.sources.forEach((source, index) => {
      bibliography += `${index + 1}. `;
      
      if (source.citation) {
        bibliography += source.citation;
      } else {
        // Fallback formatting
        const title = source.title || 'Untitled';
        const url = source.url || 'No URL available';
        const type = source.type || 'Unknown';
        const date = source.date || 'No date';
        
        bibliography += `${title}. Retrieved from ${url}. Type: ${type}. Date: ${date}`;
      }
      
      bibliography += '\n\n';
    });
  } else {
    bibliography += 'No sources available for bibliography.\n';
  }
  
  if (research.citations && research.citations.totalSources) {
    bibliography += `\nTotal Sources: ${research.citations.totalSources}\n`;
  }
  
  if (research.qualityScore) {
    bibliography += `Research Quality Score: ${research.qualityScore}/100\n`;
  }
  
  bibliography += `\nGenerated: ${new Date().toLocaleString()}`;
  
  return bibliography;
}

/**
 * POST /api/research/validate-sources
 * Validate and score research sources
 */
router.post('/validate-sources', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Sources array is required'
      });
    }

    if (sources.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 sources allowed per validation request'
      });
    }

    // Plan validation
    const planValidation = await planValidator.validateRequest(req.user.id, '', 0, 'research');
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode
      });
    }

    // Estimate credits for source validation
    const estimatedCredits = Math.ceil(sources.length * 0.5); // 0.5 credits per source

    // Deduct credits
    const creditDeductionResult = await creditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for source validation',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits
        }
      });
    }

    // Validate sources
    const validationResult = await researchService.validateSources(sources);

    // Record usage
    await planValidator.recordUsage(
      req.user.id,
      sources.length,
      estimatedCredits,
      'source_validation'
    );

    res.json({
      success: true,
      data: {
        validatedSources: validationResult.validatedSources,
        overallScore: validationResult.overallScore,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Source validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Source validation failed',
      details: error.message
    });
  }
}));

/**
 * POST /api/research/generate-citations
 * Generate formatted citations from sources
 */
router.post('/generate-citations', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { sources, format = 'apa' } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Sources array is required'
      });
    }

    const validFormats = ['apa', 'mla', 'chicago', 'harvard'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: `Invalid citation format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    if (sources.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 sources allowed per citation request'
      });
    }

    // Plan validation
    const planValidation = await planValidator.validateRequest(req.user.id, '', 0, 'research');
    if (!planValidation.isValid) {
      return res.status(403).json({
        success: false,
        error: planValidation.error,
        errorCode: planValidation.errorCode
      });
    }

    // Estimate credits for citation generation
    const estimatedCredits = Math.ceil(sources.length * 0.3); // 0.3 credits per citation

    // Deduct credits
    const creditDeductionResult = await creditSystem.deductCreditsAtomic(
      req.user.id,
      estimatedCredits,
      planValidation.userPlan.planType,
      'research'
    );

    if (!creditDeductionResult.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for citation generation',
        details: {
          required: estimatedCredits,
          available: creditDeductionResult.availableCredits
        }
      });
    }

    // Generate citations
    const citationResult = await researchService.generateCitations(sources, format);

    // Record usage
    await planValidator.recordUsage(
      req.user.id,
      sources.length,
      estimatedCredits,
      'citation_generation'
    );

    res.json({
      success: true,
      data: {
        citations: citationResult.citations,
        bibliography: citationResult.bibliography,
        format,
        creditsUsed: estimatedCredits,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Citation generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Citation generation failed',
      details: error.message
    });
  }
}));

/**
 * POST /api/research/bookmark
 * Bookmark a research source
 */
router.post('/bookmark', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { sourceId } = req.body;
    
    if (!sourceId) {
      return res.status(400).json({
        success: false,
        error: 'Source ID is required'
      });
    }

    // Save bookmark to user's collection
    await researchService.db.collection('user_bookmarks').add({
      userId: req.user.id,
      sourceId,
      createdAt: new Date()
    });

    res.json({
      success: true,
      message: 'Source bookmarked successfully'
    });

  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bookmark source'
    });
  }
}));

/**
 * GET /api/research/quote/:sourceId
 * Get a formatted quote from a source
 */
router.get('/quote/:sourceId', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { sourceId } = req.params;
    
    if (!sourceId) {
      return res.status(400).json({
        success: false,
        error: 'Source ID is required'
      });
    }

    // Generate a quote (this would typically fetch from the source)
    const quote = `"This is a sample quote from source ${sourceId}" - Research Source`;

    res.json({
      success: true,
      quote
    });

  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get quote'
    });
  }
}));

/**
 * GET /api/research/pdf/:sourceId
 * Generate PDF for a source
 */
router.get('/pdf/:sourceId', unifiedAuth, asyncErrorHandler(async (req, res) => {
  try {
    const { sourceId } = req.params;
    
    if (!sourceId) {
      return res.status(400).json({
        success: false,
        error: 'Source ID is required'
      });
    }

    // Generate PDF (placeholder implementation)
    const pdfBuffer = await pdfGenerator.generateSourcePDF(sourceId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="source-${sourceId}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate PDF'
    });
  }
}));

module.exports = router;
