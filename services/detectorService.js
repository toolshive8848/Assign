const admin = require("firebase-admin");
const ImprovedCreditSystem = require("./improvedCreditSystem");
const { OriginalityAI } = require("originality-sdk"); // adjust if your SDK name differs
const { GeminiAPI } = require("./geminiService"); // assuming you wrapped Gemini calls here

const db = admin.firestore();
const creditSystem = new ImprovedCreditSystem();

class DetectorService {
  constructor() {
    this.originality = new OriginalityAI(process.env.ORIGINALITY_API_KEY);
    this.gemini = new GeminiAPI(process.env.GEMINI_API_KEY);
  }

  /**
   * 🔹 Analyze content with Originality.ai
   */
  async analyzeContent(userId, text) {
    if (!text || text.length < 20) {
      throw new Error("Content must be at least 20 characters");
    }

    // cost example: 1 credit per 100 characters
    const cost = Math.ceil(text.length / 100);

    const session = await creditSystem.startSession(userId, cost);
    try {
      const result = await this.originality.check({
        text,
        features: ["ai", "plagiarism", "readability"]
      });

      await creditSystem.commit(session);

      // Save results in Firestore
      const ref = await db.collection("detectorResults").add({
        userId,
        text,
        result,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { id: ref.id, ...result };
    } catch (err) {
      await creditSystem.rollback(session);
      throw err;
    }
  }

  /**
   * 🔹 Remove detected issues (rewrite flagged content using Gemini)
   */
  async removeDetectedIssues(userId, text, issues) {
    if (!issues || issues.length === 0) {
      throw new Error("No issues provided to remove");
    }

    const session = await creditSystem.startSession(userId, 5); // flat fee example
    try {
      const prompt = `Rewrite the following text to remove plagiarism/AI detection issues:\n\n${text}`;
      const improved = await this.gemini.rewrite(prompt);

      await creditSystem.commit(session);

      const ref = await db.collection("detectorRemovals").add({
        userId,
        originalText: text,
        improvedText: improved,
        issues,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { id: ref.id, improved };
    } catch (err) {
      await creditSystem.rollback(session);
      throw err;
    }
  }

  /**
   * 🔹 Full workflow: detect → rewrite → re-detect
   */
  async detectAndRemoveWorkflow(userId, text) {
    const detection = await this.analyzeContent(userId, text);

    if (detection.aiScore < 20 && detection.plagiarism < 10) {
      return { message: "Content is clean enough", detection };
    }

    const rewrite = await this.removeDetectedIssues(userId, text, detection.issues || []);
    const finalCheck = await this.analyzeContent(userId, rewrite.improved);

    return { detection, rewrite, finalCheck };
  }
}

module.exports = DetectorService;
