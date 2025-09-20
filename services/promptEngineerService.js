const admin = require("firebase-admin");
const ImprovedCreditSystem = require("./improvedCreditSystem");
const { GeminiAPI } = require("./geminiService"); // assuming you already wrapped Gemini

const db = admin.firestore();
const creditSystem = new ImprovedCreditSystem();

class PromptEngineerService {
  constructor() {
    this.gemini = new GeminiAPI(process.env.GEMINI_API_KEY);
  }

  /**
   * 🔹 Optimize a prompt (paid with credits)
   */
  async optimizePrompt(originalPrompt, category, userId) {
    if (!originalPrompt || originalPrompt.length < 10) {
      throw new Error("Prompt must be at least 10 characters long");
    }

    // Example cost: 2 credits per 50 words
    const wordCount = originalPrompt.split(/\s+/).length;
    const cost = Math.ceil(wordCount / 50) * 2;

    const session = await creditSystem.startSession(userId, cost);
    try {
      const optimized = await this.gemini.rewrite(
        `Optimize this ${category} prompt: ${originalPrompt}`
      );

      await creditSystem.commit(session);

      // Save in Firestore
      const ref = await db.collection("promptOptimizations").add({
        userId,
        originalPrompt,
        optimizedPrompt: optimized,
        category,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { id: ref.id, optimized };
    } catch (err) {
      await creditSystem.rollback(session);
      throw err;
    }
  }

  /**
   * 🔹 Analyze prompt (paid with credits)
   */
  async analyzePromptWithCredits(prompt, userId) {
    if (!prompt || prompt.length < 10) {
      throw new Error("Prompt must be at least 10 characters long");
    }

    // Example cost: 1 credit per 30 words
    const wordCount = prompt.split(/\s+/).length;
    const cost = Math.ceil(wordCount / 30);

    const session = await creditSystem.startSession(userId, cost);
    try {
      const analysis = await this.gemini.scorePrompt(
        `Analyze this prompt for clarity, specificity, and context: ${prompt}`
      );

      await creditSystem.commit(session);

      const ref = await db.collection("promptAnalyses").add({
        userId,
        prompt,
        analysis,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { id: ref.id, ...analysis };
    } catch (err) {
      await creditSystem.rollback(session);
      throw err;
    }
  }

  /**
   * 🔹 Analyze prompt (free, no credits)
   */
  async analyzePromptFree(prompt) {
    if (!prompt || prompt.length < 10) {
      throw new Error("Prompt must be at least 10 characters long");
    }

    // Free mode: simplified Gemini call
    return this.gemini.scorePrompt(
      `Analyze this prompt (free mode, quick insights): ${prompt}`
    );
  }

  /**
   * 🔹 Get user’s credit info
   */
  async getUserCreditInfo(userId) {
    const doc = await db.collection("users").doc(userId).get();
    if (!doc.exists) return { credits: 0, planType: "freemium" };
    const data = doc.data();
    return { credits: data.credits || 0, planType: data.planType || "freemium" };
  }

  /**
   * 🔹 Get optimization & analysis history
   */
  async getHistory(userId) {
    const [optSnap, anaSnap] = await Promise.all([
      db.collection("promptOptimizations")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get(),
      db.collection("promptAnalyses")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get(),
    ]);

    return {
      optimizations: optSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      analyses: anaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    };
  }
}

module.exports = PromptEngineerService;
