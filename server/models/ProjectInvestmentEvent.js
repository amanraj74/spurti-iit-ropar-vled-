import mongoose from 'mongoose';

const projectInvestmentEventSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  type: { type: String, default: 'project_investment' },
  // Event lifecycle
  isActive: { type: Boolean, default: false },        // Visible to students?
  isConcluded: { type: Boolean, default: false },     // Trading closed?
  // VC economy
  startingVCPerTeam: { type: Number, default: 1000 },
  minInvestment: { type: Number, default: 100 },
  maxInvestment: { type: Number, default: 1000 },
  // Dates
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  // Rankings / winners
  rankings: [{
    rank: Number,
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    teamName: String,
    totalReceived: Number,
    investorCount: Number
  }]
}, { timestamps: true });

projectInvestmentEventSchema.index({ isActive: 1 });
projectInvestmentEventSchema.index({ isConcluded: 1 });

export default mongoose.model('ProjectInvestmentEvent', projectInvestmentEventSchema);
