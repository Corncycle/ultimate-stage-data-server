/* miscDataTools.js
 *
 * A library of functions for generating and saving a current MiscData document
 *
 * Functions may both query Start.gg's API and USD's database through Mongoose
 */

const mongoTools = require('./utility/mongoTools')
const util = require('./utility/util')

const MiscData = require('../models/miscData')
const ProcessedTournament = require('../models/processedTournament')

exports.createCurrentMiscDataJsObject = async () => {
  const [
    totalGameCount,
    totalOnlineGameCount,
    totalOfflineGameCount,
    totalEventSlugsWithData,
    totalEventSlugsLightlyInspected,
    allCharactersOverallData,
    lastTenProcessedSlugs,
  ] = await Promise.all([
    mongoTools.getTotalGames(),
    mongoTools.getTotalGames({ isOnline: true }),
    mongoTools.getTotalGames({ isOnline: false }),
    mongoTools.countUniqueEventSlugs(),
    ProcessedTournament.count(),
    mongoTools.getAllCharacterDataOverall(),
    mongoTools.getLastNProcessedEventsWithDataSlugs(10),
  ])

  allCharactersOverallData.sort((a, b) => {
    return a.wins / (a.wins + a.losses) - b.wins / (b.wins + b.losses)
  })

  const best = allCharactersOverallData[allCharactersOverallData.length - 1]
  const worst = allCharactersOverallData[0]

  const bestWinCharName = best.name
  const bestWinCharPct = util.round2(
    (100 * best.wins) / (best.wins + best.losses)
  )

  const worstWinCharName = worst.name
  const worstWinCharPct = util.round2(
    (100 * worst.wins) / (worst.wins + worst.losses)
  )

  allCharactersOverallData.sort((a, b) => {
    return a.wins + a.losses - (b.wins + b.losses)
  })

  const most = allCharactersOverallData[allCharactersOverallData.length - 1]
  const least = allCharactersOverallData[0]

  const mostGamesCharName = most.name
  const mostGamesCharCount = most.wins + most.losses

  const leastGamesCharName = least.name
  const leastGamesCharCount = least.wins + least.losses

  return {
    timestamp: new Date(),
    totalGameCount,
    totalOnlineGameCount,
    totalOfflineGameCount,
    totalEventSlugsWithData,
    totalEventSlugsLightlyInspected,
    bestWinCharName,
    bestWinCharPct,
    worstWinCharName,
    worstWinCharPct,
    mostGamesCharName,
    mostGamesCharCount,
    leastGamesCharName,
    leastGamesCharCount,
    lastTenProcessedSlugs,
  }
}

exports.saveMiscDataObjectToDatabase = async (miscDataObject) => {
  try {
    const miscData = new MiscData(miscDataObject)
    await miscData.save()
  } catch (err) {
    console.log('Error saving new MiscData object')
    throw err
  }
}

exports.getCurrentMiscData = async () => {
  if (this.currMiscData) {
    return this.currMiscData
  }
  const query = await MiscData.findOne({}).sort({ timestamp: -1 })
  const obj = query.toObject()
  this.currMiscData = obj
  return obj
}

exports.setCurrentMiscData = async (miscDataObject) => {
  await this.saveMiscDataObjectToDatabase(miscDataObject)
  await this.getCurrentMiscData()
}

exports.makeAndSetCurrentMiscData = async () => {
  await this.setCurrentMiscData(await this.createCurrentMiscDataJsObject())
}