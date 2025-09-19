const express = require('express');
const multer = require('multer');
const path = require('path');
const FileProcessingService = require('../services/fileProcessingService');
const llmService = require('../services/llmService');
const ContentDatabase = require('../services/contentDatabase');
const MultiPartGenerator = require('../services/multiPartGenerator');
const { unifiedAuth } = require('../middleware/unifiedAuth');
const { asyncErrorHandler } = require('../middleware/errorHandler');
const { validateWriterInput, handleValidationErrors } = require('../middleware/validation');
const ImprovedCreditSystem = require('../services/improvedCreditSystem');
const PlanValidator = require('../services/planValidator');
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');

const router = express.Router();
const fileProcessingService = new FileProcessingService();
const contentDatabase = new ContentDatabase();
const multiPartGenerator = new MultiPartGenerator();
const creditSystem = new ImprovedCreditSystem();
const planValidator = new PlanValidator();

// Multer config for uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Allowed: PDF, DOCX, TXT`), false);
  }
});

/**
 * Assignment content generator (fallback template if LLM fails)
 */
const generateAssignmentContent = async (title, description, wordCount, citationStyle, style = 'Academic', tone = 'Formal') => {
  const styleTemplates = {
    'Academic': {
      introduction: 'This scholarly examination explores',
      transition: 'Furthermore, research indicates that',
      conclusion: 'In conclusion, the evidence demonstrates'
    },
    'Business': {
      introduction: 'This business analysis examines',
      transition: 'Market data suggests that',
      conclusion: 'The strategic implications indicate'
    },
    'Creative': {
      introduction: 'Imagine a world where',
      transition: 'As we delve deeper into this narrative',
      conclusion: 'The story ultimately reveals'
    }
  };
  const selectedStyle = styleTemplates[style] || styleTemplates['Academic'];

  const prompt = `Write a ${wordCount}-word ${style.toLowerCase()} ${tone.toLowerCase()} assignment on "${title}". ${description ? `Instructions: ${description}` : ''} Use ${citationStyle} citation style.`;

  try {
    const generatedContent = await llmService.generateContent(prompt, {
      maxTokens: Math.ceil(wordCount * 1.5),
      temperature: 0.7,
      style,
      tone
    });
    return generatedContent;
  } catch (error) {
    console.error('Error generating assignment, using fallback:', error);
    return `
# ${title}

## Introduction
${selectedStyle.introduction} the topic of "${title}" with detailed analysis.

## Main Body
${selectedStyle.transition} [Content will be generated here]

## Conclusion
${selectedStyle.conclusion} significant insights.

## References
(Sample references in ${citationStyle} format)
    `.trim();
  }
};

/**
 * POST /api/writer/generate
 */
router.post('/generate', unifiedAuth, validateWriterInput, handleValidationErrors, asyncErrorHandler(async (req, res) => {
  try {
    const { prompt, style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard', contentType = 'general', assignmentTitle, citationStyle = 'APA' } = req.body;
    const userId = req.user.userId;

    if (!prompt?.trim()) return res.status(400).json({ success: false, error: 'Prompt is required' });
    if (wordCount < 100 || wordCount > 2000) return res.status(400).json({ success: false, error: 'Word count must be between 100 and 2000' });
    if (contentType === 'assignment' && !assignmentTitle?.trim()) return res.status(400).json({ success: false, error: 'Assignment title required' });

    const planValidation = await planValidator.validateUserPlan(userId, { toolType: 'writing', requestType: 'generation' });
    if (!planValidation.isValid) return res.status(403).json({ success: false, error: planValidation.error });

    const baseCredits = creditSystem.calculateRequiredCredits(wordCount, 'writing');
    const creditsNeeded = qualityTier === 'premium' ? baseCredits * 2 : baseCredits;

    let creditResult;
    try {
      creditResult = await creditSystem.deductCreditsAtomic(userId, creditsNeeded, planValidation.userPlan.planType, 'writing');
    } catch (deductionError) {
      return res.status(400).json({ success: false, error: deductionError.message });
    }

    const useMultiPart = wordCount > 800 || (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
    const enableRefinement = qualityTier === 'premium';
    let result, contentSource = 'new_generation';

    try {
      if (contentType === 'assignment') {
        if (qualityTier === 'premium' && (useMultiPart || enableRefinement)) {
          result = await multiPartGenerator.generateMultiPartContent({
            userId,
            prompt: `Assignment Title: ${assignmentTitle}\n\nInstructions: ${prompt}`,
            requestedWordCount: wordCount,
            userPlan: planValidation.userPlan.planType,
            style,
            tone,
            subject: assignmentTitle,
            additionalInstructions: `Generate academic assignment with ${citationStyle} citations`,
            requiresCitations: true,
            citationStyle,
            qualityTier,
            enableRefinement
          });
          contentSource = result.usedSimilarContent ? 'assignment_multipart_optimized' : 'assignment_multipart_new';
        } else {
          const assignmentContent = await generateAssignmentContent(assignmentTitle, prompt, wordCount, citationStyle, style, tone);
          result = { content: assignmentContent, wordCount: assignmentContent.split(/\s+/).length, generationTime: 2000, chunksGenerated: 1, refinementCycles: enableRefinement ? 1 : 0 };
          contentSource = enableRefinement ? 'assignment_refined' : 'assignment_new';
        }
      } else if (useMultiPart) {
        result = await multiPartGenerator.generateMultiPartContent({
          userId, prompt, requestedWordCount: wordCount, userPlan: planValidation.userPlan.planType, style, tone, qualityTier, enableRefinement
        });
        contentSource = result.usedSimilarContent ? 'multipart_optimized' : 'multipart_new';
      } else {
        const similarContent = await contentDatabase.findSimilarContent(prompt, style, tone, wordCount);
        if (similarContent?.length > 0) {
          const bestMatch = similarContent[0];
          const polishingContent = await contentDatabase.getContentForPolishing(bestMatch.contentId, wordCount);
          if (polishingContent?.sections) {
            result = await llmService.polishExistingContent(polishingContent.sections, prompt, style, tone, wordCount, qualityTier);
            contentSource = 'optimized_existing';
            await contentDatabase.updateAccessStatistics([bestMatch.contentId]);
          } else {
            result = await llmService.generateContent(prompt, style, tone, wordCount, qualityTier);
          }
        } else {
          result = await llmService.generateContent(prompt, style, tone, wordCount, qualityTier);
        }
        if (result?.content) await contentDatabase.storeContent(userId, prompt, result.content, { style, tone, source: contentSource, wordCount });
      }

      res.json({
        success: true,
        content: result.content,
        metadata: { contentSource, wordCount: result.wordCount || wordCount, creditsUsed: creditsNeeded, remainingCredits: creditResult.newBalance, qualityTier, enabledRefinement, contentType, assignmentTitle, citationStyle }
      });
    } catch (genError) {
      await creditSystem.refundCredits(userId, creditsNeeded, creditResult.transactionId || 'failed_generation');
      return res.status(500).json({ success: false, error: 'Content generation failed', details: genError.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
  }
}));

/**
 * POST /api/writer/upload-and-generate
 * (same credit system integration as /generate)
 */
router.post('/upload-and-generate', unifiedAuth, upload.array('files', 10), validateWriterInput, handleValidationErrors, asyncErrorHandler(async (req, res) => {
  try {
    const { additionalPrompt = '', style = 'Academic', tone = 'Formal', wordCount = 500, qualityTier = 'standard' } = req.body;
    const files = req.files;
    const userId = req.user.userId;

    if (!files?.length) return res.status(400).json({ success: false, error: 'No files uploaded' });
    if (wordCount < 100 || wordCount > 2000) return res.status(400).json({ success: false, error: 'Word count must be between 100 and 2000' });

    const planValidation = await planValidator.validateUserPlan(userId, { toolType: 'writing', requestType: 'generation' });
    if (!planValidation.isValid) return res.status(403).json({ success: false, error: planValidation.error });

    const baseCredits = creditSystem.calculateRequiredCredits(wordCount, 'writing');
    const creditsNeeded = qualityTier === 'premium' ? baseCredits * 2 : baseCredits;

    let creditResult;
    try {
      creditResult = await creditSystem.deductCreditsAtomic(userId, creditsNeeded, planValidation.userPlan.planType, 'writing');
    } catch (deductionError) {
      return res.status(400).json({ success: false, error: deductionError.message });
    }

    try {
      const result = await fileProcessingService.processFilesAndGenerate(files, additionalPrompt, style, tone);
      if (!result.success) {
        await creditSystem.refundCredits(userId, creditsNeeded, creditResult.transactionId || 'failed_file_processing');
        return res.status(400).json(result);
      }

      let llmResult, contentSource = 'new_generation';
      const useMultiPart = wordCount > 800 || (planValidation.userPlan.planType !== 'freemium' && wordCount > 500);
      const enableRefinement = qualityTier === 'premium';

      if (useMultiPart) {
        llmResult = await multiPartGenerator.generateMultiPartContent({ userId, prompt: result.prompt, requestedWordCount: wordCount, userPlan: planValidation.userPlan.planType, style, tone, qualityTier, enableRefinement });
        contentSource = llmResult.usedSimilarContent ? 'multipart_optimized_files' : 'multipart_new_files';
      } else {
        const similarContent = await contentDatabase.findSimilarContent(result.prompt, style, tone, wordCount);
        if (similarContent?.length > 0) {
          const bestMatch = similarContent[0];
          const polishingContent = await contentDatabase.getContentForPolishing(bestMatch.contentId, wordCount);
          if (polishingContent?.sections) {
            llmResult = await llmService.polishExistingContent(polishingContent.sections, result.prompt, style, tone, wordCount, qualityTier);
            contentSource = 'optimized_existing';
            await contentDatabase.updateAccessStatistics([bestMatch.contentId]);
          } else {
            llmResult = await llmService.generateContent(result.prompt, style, tone, wordCount, qualityTier);
          }
        } else {
          llmResult = await llmService.generateContent(result.prompt, style, tone, wordCount, qualityTier);
        }
        if (llmResult?.content) await contentDatabase.storeContent(userId, result.prompt, llmResult.content, { style, tone, source: contentSource, wordCount, basedOnFiles: true, fileCount: files.length });
      }

      res.json({
        success: true,
        content: llmResult.content,
        extractedContent: result.extractedContent,
        generatedPrompt: result.prompt,
        metadata: { contentSource, creditsUsed: creditsNeeded, remainingCredits: creditResult.newBalance, qualityTier, basedOnFiles: true, fileCount: files.length }
      });
    } catch (genError) {
      await creditSystem.refundCredits(userId, creditsNeeded, creditResult.transactionId || 'failed_generation');
      return res.status(500).json({ success: false, error: 'Content generation failed', details: genError.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
  }
}));

/**
 * GET /api/writer/supported-formats
 */
router.get('/supported-formats', (req, res) => {
  res.json({
    success: true,
    formats: [
      { extension: '.pdf', description: 'Portable Document Format', maxSize: '10MB' },
      { extension: '.docx', description: 'Microsoft Word Document', maxSize: '10MB' },
      { extension: '.txt', description: 'Plain Text File', maxSize: '10MB' }
    ],
    limits: { maxFiles: 5, maxFileSize: '10MB', totalMaxSize: '50MB' }
  });
});

/**
 * POST /api/writer/validate-files
 */
router.post('/validate-files', unifiedAuth, upload.array('files', 5), asyncErrorHandler(async (req, res) => {
  const files = req.files;
  if (!files?.length) return res.status(400).json({ success: false, error: 'No files provided' });
  const validation = fileProcessingService.validateFiles(files);
  res.json({ success: validation.valid, valid: validation.valid, errors: validation.errors || [], fileInfo: files.map(file => ({ name: file.originalname, size: file.size, type: path.extname(file.originalname).toLowerCase(), sizeFormatted: `${(file.size / 1024 / 1024).toFixed(2)} MB` })) });
}));

/**
 * POST /api/writer/download
 * Proper DOCX download
 */
router.post('/download', asyncErrorHandler(async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, error: 'Title and content are required' });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ text: title, heading: HeadingLevel.HEADING1 }),
        ...content.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }))
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

/**
 * GET /api/writer/health
 */
router.get('/health', async (req, res) => {
  const status = await creditSystem.healthCheck();
  res.json(status);
});

module.exports = router;
