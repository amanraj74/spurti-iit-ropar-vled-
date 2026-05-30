import express from 'express';
import Team from '../models/Team.js';
import ProjectInvestmentEvent from '../models/ProjectInvestmentEvent.js';
import TeamProject from '../models/TeamProject.js';
import Investment from '../models/Investment.js';
import TeamWallet from '../models/TeamWallet.js';
import Student from '../models/Student.js';

const router = express.Router();

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

async function getTeamForStudent(email) {
  // Find which team this student belongs to
  const team = await Team.findOne({ 'members.email': email.toLowerCase() }).lean();
  return team;
}

async function getActiveEvent() {
  return ProjectInvestmentEvent.findOne({ isActive: true, isConcluded: false }).lean();
}

// Admin guard — must have admin headers
function adminGuard(req, res, next) {
  const adminEmail = req.headers['x-admin-email'];
  const adminToken = req.headers['x-admin-token'];
  if (!adminEmail || adminToken !== 'vled-local-admin') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Student auth guard — must have valid student cookie
function studentGuard(req, res, next) {
  const cookieEmail = req.headers['x-student-email'];
  if (!cookieEmail) {
    return res.status(401).json({ error: 'Not authenticated as student' });
  }
  next();
}

// ═══════════════════════════════════════════
// STUDENT ROUTES
// ═══════════════════════════════════════════

// GET /investment-event/active — is there an active event?
router.get('/active', async (req, res) => {
  try {
    const event = await getActiveEvent();
    res.json({ hasActiveEvent: !!event, event: event ? { _id: event._id, name: event.name } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/market — all projects with investment totals
router.get('/market', async (req, res) => {
  try {
    const event = await getActiveEvent();
    if (!event) return res.json({ projects: [], event: null });

    const projects = await TeamProject.find({ eventId: event._id }).sort({ totalInvestmentReceived: -1 }).lean();

    res.json({
      event: {
        _id: event._id,
        name: event.name,
        minInvestment: event.minInvestment,
        maxInvestment: event.maxInvestment,
        startingVCPerTeam: event.startingVCPerTeam,
        isConcluded: event.isConcluded
      },
      projects: projects.map(p => ({
        _id: p._id,
        teamId: p.teamId,
        teamName: p.teamName,
        projectName: p.projectName,
        description: p.description,
        totalInvestmentReceived: p.totalInvestmentReceived,
        investorCount: p.investorCount
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/my-team — get student's team info
router.get('/my-team', async (req, res) => {
  try {
    const email = req.headers['x-student-email'];
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const team = await getTeamForStudent(email);
    if (!team) return res.json({ team: null, isLeader: false });

    const member = team.members.find(m => m.email.toLowerCase() === email.toLowerCase());
    res.json({ team, isLeader: !!member?.isLeader });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/wallet — my team's VC wallet
router.get('/wallet', async (req, res) => {
  try {
    const email = req.headers['x-student-email'];
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const team = await getTeamForStudent(email);
    if (!team) return res.json({ wallet: null });

    const event = await getActiveEvent();
    if (!event) return res.json({ wallet: null });

    let wallet = await TeamWallet.findOne({ eventId: event._id, teamId: team._id }).lean();
    res.json({
      wallet: wallet ? {
        totalVC: wallet.totalVC,
        investedVC: wallet.investedVC,
        availableVC: wallet.totalVC - wallet.investedVC
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/my-investments — all investments made by student's team
router.get('/my-investments', async (req, res) => {
  try {
    const email = req.headers['x-student-email'];
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const team = await getTeamForStudent(email);
    if (!team) return res.json({ investments: [] });

    const event = await getActiveEvent();
    if (!event) return res.json({ investments: [] });

    const investments = await Investment.find({ eventId: event._id, investorTeamId: team._id })
      .sort({ createdAt: -1 }).lean();

    res.json({
      investments: investments.map(i => ({
        _id: i._id,
        targetTeamName: i.targetTeamName,
        targetProjectName: i.targetProjectName,
        amount: i.amount,
        comment: i.comment,
        createdAt: i.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /investment-event/invest — submit an investment
router.post('/invest', async (req, res) => {
  try {
    const email = req.headers['x-student-email'];
    if (!email) return res.status(401).json({ error: 'Not authenticated' });

    const { projectId, amount, comment } = req.body;
    if (!projectId || !amount || !comment) {
      return res.status(400).json({ error: 'projectId, amount, and comment are required' });
    }

    // Verify student is a leader
    const team = await getTeamForStudent(email);
    if (!team) return res.status(403).json({ error: 'You are not in any team' });
    const member = team.members.find(m => m.email.toLowerCase() === email.toLowerCase());
    if (!member?.isLeader) return res.status(403).json({ error: 'Only team leaders can invest' });

    const event = await getActiveEvent();
    if (!event) return res.status(403).json({ error: 'No active event' });
    if (event.isConcluded) return res.status(403).json({ error: 'Event has concluded' });

    // Get project
    const project = await TeamProject.findById(projectId).lean();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.eventId.toString() !== event._id.toString()) {
      return res.status(400).json({ error: 'Project is not part of this event' });
    }

    // Cannot invest in own team
    if (project.teamId.toString() === team._id.toString()) {
      return res.status(400).json({ error: 'Cannot invest in your own team project' });
    }

    // Check wallet balance
    let wallet = await TeamWallet.findOne({ eventId: event._id, teamId: team._id }).lean();
    if (!wallet) return res.status(400).json({ error: 'Team wallet not found' });
    const availableVC = wallet.totalVC - wallet.investedVC;

    // Validate amount
    if (amount < event.minInvestment) return res.status(400).json({ error: `Minimum investment is ${event.minInvestment} VC` });
    if (amount > event.maxInvestment) return res.status(400).json({ error: `Maximum single investment is ${event.maxInvestment} VC` });
    if (amount > availableVC) return res.status(400).json({ error: `Insufficient VC. Available: ${availableVC} VC` });

    // Check remaining budget
    if (amount > availableVC) return res.status(400).json({ error: 'Insufficient VC balance' });

    // Create investment
    const investment = await Investment.create({
      eventId: event._id,
      investorTeamId: team._id,
      investorTeamName: team.name,
      investorLeaderEmail: email.toLowerCase(),
      targetProjectId: project._id,
      targetTeamName: project.teamName,
      targetProjectName: project.projectName,
      amount,
      comment
    });

    // Update project stats
    await TeamProject.findByIdAndUpdate(projectId, {
      $inc: { totalInvestmentReceived: amount, investorCount: 1 }
    });

    // Update wallet
    await TeamWallet.findOneAndUpdate(
      { eventId: event._id, teamId: team._id },
      { $inc: { investedVC: amount } }
    );

    // Updated wallet
    wallet = await TeamWallet.findOne({ eventId: event._id, teamId: team._id }).lean();

    res.json({
      success: true,
      investment: {
        _id: investment._id,
        targetTeamName: investment.targetTeamName,
        targetProjectName: investment.targetProjectName,
        amount: investment.amount,
        comment: investment.comment,
        createdAt: investment.createdAt
      },
      wallet: {
        totalVC: wallet.totalVC,
        investedVC: wallet.investedVC,
        availableVC: wallet.totalVC - wallet.investedVC
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════

// GET /investment-event/admin/teams
router.get('/admin/teams', adminGuard, async (req, res) => {
  try {
    const teams = await Team.find().sort({ name: 1 }).lean();
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /investment-event/admin/teams
router.post('/admin/teams', adminGuard, async (req, res) => {
  try {
    const { name, description, members } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    const team = await Team.create({
      name,
      description: description || '',
      members: members || []
    });

    res.json(team);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Team name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /investment-event/admin/teams/:id
router.put('/admin/teams/:id', adminGuard, async (req, res) => {
  try {
    const { name, description, members } = req.body;
    const team = await Team.findByIdAndUpdate(
      req.params.id,
      { name, description, members },
      { new: true, runValidators: true }
    ).lean();
    if (!team) return res.status(404).json({ error: 'Team not found' });
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /investment-event/admin/teams/:id
router.delete('/admin/teams/:id', adminGuard, async (req, res) => {
  try {
    await Team.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/admin/events
router.get('/admin/events', adminGuard, async (req, res) => {
  try {
    const events = await ProjectInvestmentEvent.find().sort({ createdAt: -1 }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /investment-event/admin/events
router.post('/admin/events', adminGuard, async (req, res) => {
  try {
    const { name, description, startingVCPerTeam, minInvestment, maxInvestment, startDate, endDate } = req.body;

    // Deactivate all other events
    await ProjectInvestmentEvent.updateMany({}, { isActive: false });

    const event = await ProjectInvestmentEvent.create({
      name: name || 'Project Investment',
      description: description || '',
      type: 'project_investment',
      isActive: true,
      isConcluded: false,
      startingVCPerTeam: startingVCPerTeam || 1000,
      minInvestment: minInvestment || 100,
      maxInvestment: maxInvestment || 1000,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null
    });

    // Create wallets for all existing teams
    const teams = await Team.find().lean();
    await TeamWallet.insertMany(teams.map(t => ({
      eventId: event._id,
      teamId: t._id,
      teamName: t.name,
      totalVC: event.startingVCPerTeam,
      investedVC: 0
    })));

    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /investment-event/admin/events/:id
router.put('/admin/events/:id', adminGuard, async (req, res) => {
  try {
    const { isActive, isConcluded, name, description, minInvestment, maxInvestment, endDate } = req.body;
    const update = {};
    if (isActive !== undefined) {
      if (isActive) {
        // Deactivate all others first
        await ProjectInvestmentEvent.updateMany({}, { isActive: false });
      }
      update.isActive = isActive;
    }
    if (isConcluded !== undefined) update.isConcluded = isConcluded;
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (minInvestment !== undefined) update.minInvestment = minInvestment;
    if (maxInvestment !== undefined) update.maxInvestment = maxInvestment;
    if (endDate !== undefined) update.endDate = endDate ? new Date(endDate) : null;

    const event = await ProjectInvestmentEvent.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /investment-event/admin/projects — create/update team project
router.post('/admin/projects', adminGuard, async (req, res) => {
  try {
    const { eventId, teamId, projectName, description } = req.body;
    if (!eventId || !teamId || !projectName) {
      return res.status(400).json({ error: 'eventId, teamId, projectName required' });
    }

    const team = await Team.findById(teamId).lean();
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const project = await TeamProject.findOneAndUpdate(
      { eventId, teamId },
      {
        eventId,
        teamId,
        teamName: team.name,
        projectName,
        description: description || '',
        createdBy: team.members.find(m => m.isLeader)?._id || null,
        createdByEmail: team.members.find(m => m.isLeader)?.email || ''
      },
      { upsert: true, new: true }
    ).lean();

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/admin/investments — all investments
router.get('/admin/investments', adminGuard, async (req, res) => {
  try {
    const { eventId } = req.query;
    const filter = eventId ? { eventId } : {};
    const investments = await Investment.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json(investments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /investment-event/admin/wallets
router.get('/admin/wallets', adminGuard, async (req, res) => {
  try {
    const { eventId } = req.query;
    const filter = eventId ? { eventId } : {};
    const wallets = await TeamWallet.find(filter).sort({ teamName: 1 }).lean();
    res.json(wallets.map(w => ({
      ...w,
      availableVC: w.totalVC - w.investedVC
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /investment-event/admin/conclude — end event and compute rankings
router.post('/admin/conclude/:id', adminGuard, async (req, res) => {
  try {
    const event = await ProjectInvestmentEvent.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Get all projects ranked by investment received
    const projects = await TeamProject.find({ eventId: event._id })
      .sort({ totalInvestmentReceived: -1 })
      .lean();

    const rankings = projects.map((p, i) => ({
      rank: i + 1,
      teamId: p.teamId,
      teamName: p.teamName,
      totalReceived: p.totalInvestmentReceived,
      investorCount: p.investorCount
    }));

    const updated = await ProjectInvestmentEvent.findByIdAndUpdate(
      req.params.id,
      { isConcluded: true, isActive: false, rankings },
      { new: true }
    ).lean();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
