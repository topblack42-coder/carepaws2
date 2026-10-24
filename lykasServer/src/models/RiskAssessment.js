const mongoose = require("mongoose");

const scoreField = { type: Number, min: 1, max: 5, required: true };

const riskAssessmentSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pet: { type: mongoose.Schema.Types.ObjectId, ref: "Pet", required: true },
    assessedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scores: {
      housingStability: scoreField,
      financialReadiness: scoreField,
      petExperience: scoreField,
      lifestyleMatch: scoreField,
      familyCommitment: scoreField,
      knowledgeOfPet: scoreField,
    },
    totalScore: { type: Number, min: 6, max: 30 },
    riskLevel: { type: String, enum: ["Low", "Medium", "High"] },
    notes: { type: String, default: "" },
    redFlags: [{ type: String }],
    recommendation: { type: String, enum: ["Approve", "Reject", "Further Review"] },
  },
  { timestamps: true }
);

// Reproduces the exact scoring algorithm from the source's pre("save")
// hook: totalScore = sum of the six 1-5 scores (range 6-30), then
// riskLevel = Low if >= 24, Medium if >= 15, else High. Computed
// server-side on every save — never trust a client-supplied riskLevel
// or totalScore (§5.2).
riskAssessmentSchema.pre("save", function computeRisk() {
  const s = this.scores;
  this.totalScore =
    s.housingStability + s.financialReadiness + s.petExperience + s.lifestyleMatch + s.familyCommitment + s.knowledgeOfPet;

  if (this.totalScore >= 24) this.riskLevel = "Low";
  else if (this.totalScore >= 15) this.riskLevel = "Medium";
  else this.riskLevel = "High";
});

module.exports = mongoose.model("RiskAssessment", riskAssessmentSchema);