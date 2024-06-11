/* apiTools.js
 *
 * A library of functions to communicate with Start.gg's GraphQL API
 *
 * Functions can make asynchronous requests to Start.gg, return ordinary Javascript objects, and do not communicate with USD's databases
 */

const axios = require('axios')

const util = require('./util')

const checkRepresentativeSet = require('../queries/checkRepresentativeSet')
const findValidTournamentsInPeriod = require('../queries/findValidTournamentsInPeriod')
const getSetDataFromEvent = require('../queries/getSetDataFromEvent')
const getOnlineStatusOfEventSlug = require('../queries/getOnlineStatusOfEventSlug')
const getEventSlugsFromTournamentSlug = require('../queries/getEventSlugsFromTournamentSlug')
const getPlayerInfoFromEntrantID = require('../queries/getPlayerInfoFromEntrantID')
const getPlayerInfoFromPlayerID = require('../queries/getPlayerInfoFromPlayerID')
const getPlayerInfoFromSetID = require('../queries/getPlayerInfoFromSetID')

/** Given a Promise `prom`, return a Promise that resolves to the same value as `prom` after it resolves, or after n seconds, whichever is longer */
exports.stallPromise = async (prom, n) => {
  const nSecondPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve('blah')
    }, n * 1000)
  })

  const pAll = await Promise.all([prom, nSecondPromise])
  return pAll[0]
}

/** Asynchronously make a request to Start.gg's GraphQL API
 * @param {string} query - The GraphQL query
 * @param {Object} variables - An object whose key: value pairs give the variables for the query
 * @param {string} logMessage - An optional log message passed to `console.log` when making the query
 */
exports.makeGraphQLRequest = async (query, variables, logMessage) => {
  console.log(`Sending request... ${logMessage || ''}`)
  try {
    const res = await axios.post(
      'https://api.start.gg/gql/alpha',
      { query, variables },
      {
        headers: {
          'content-type': 'text/json',
          Authorization: `Bearer ${process.env.START_GG_API_KEY}`,
        },
      }
    )
    if (res.data.errors) {
      return res.data
    } else {
      return res.data.data
    }
  } catch (e) {
    console.log('Error making GraphQL request')
    if (e.response) {
      if (e.response.data) {
        if (
          e.response.data.includes(
            "We're working to restore all services as soon as possible. Please check back soon."
          )
        ) {
          console.log('Start.gg API had a hiccup')
        } else {
          console.log('Although a connection with Start.gg was made:')
          console.log(e.response.data)
        }
      }
    } else {
      console.log('Failed to connect to Start.gg API')
    }
    throw e
  }
}

/** A wrapper for `makeGraphQLRequest`
 *
 * Asynchronously make a request to Start.gg's GraphQL API, retrying up to `n` total tries in the event of a failed query
 *
 * Parameters are the same as for `makeGraphQLRequest`, except
 * @param {number} n - The maximum number of attempts to make the request
 * @param {number} delayBetweenQueries - The amount of time between reattempted queries
 */
exports.makeGraphQLRequestUpToNTimes = async (
  query,
  variables,
  n,
  delayBetweenQueries,
  logMessage
) => {
  let err
  for (let i = 0; i < n; i++) {
    try {
      if (i > 0) {
        console.log('Retrying...')
      }
      return await this.stallPromise(
        this.makeGraphQLRequest(query, variables, logMessage),
        delayBetweenQueries
      )
    } catch (e) {
      await this.stallPromise(null, delayBetweenQueries)
      err = e
    }
  }
  console.log(`Failed to make GraphQL request even with ${n} tries`)
  if (err) {
    throw err
  }
}

/** A specific case of `makeGraphQLRequestUpToNTimes`
 *
 * Asynchronously make a request to Start.gg's GraphQL API, retrying up to 5 total tries in the event of a failed query
 *
 * @param {string} query - The GraphQL query
 * @param {Object} variables - An object whose key: value pairs give the variables for the query
 * @param {number} delayBetweenQueries - The amount of time between reattempted queries
 * @param {string} logMessage - An optional log message passed to `console.log` when making the query
 */
exports.makeGraphQLRequestStubborn = async (
  query,
  variables,
  delayBetweenQueries,
  logMessage
) => {
  return await this.makeGraphQLRequestUpToNTimes(
    query,
    variables,
    10,
    delayBetweenQueries,
    logMessage
  )
}

/** Asynchronously return an array of strings of slugs of events at a given tournament slug */
exports.getEventSlugsFromTournamentSlug = async (slug) => {
  const delayBetweenQueries = 1.3
  const response = await this.makeGraphQLRequestStubborn(
    getEventSlugsFromTournamentSlug.query,
    {
      slug,
    },
    delayBetweenQueries,
    `Getting events at tournament ${slug}...`
  )
  try {
    const out = []
    for (const obj of response.tournament.events) {
      out.push(obj.slug)
    }
    return out
  } catch (e) {
    console.log(`Could not find events at tournament ${slug}`)
    throw e
  }
}

exports.getAllBlacklistedEvents = async () => {
  const tournaments = await util.getArrayFromFile(
    './database-scripts/blacklistedTournaments.json'
  )
  let blacklistedEvents = []
  for (const tournament of tournaments) {
    blacklistedEvents = blacklistedEvents.concat(
      await this.getEventSlugsFromTournamentSlug(tournament)
    )
  }
  return blacklistedEvents
}

exports.getOnlineStatusOfEventSlug = async (slug) => {
  const delayBetweenQueries = 1.3
  const response = await this.makeGraphQLRequestStubborn(
    getOnlineStatusOfEventSlug.query,
    {
      slug,
    },
    delayBetweenQueries,
    `Checking online status of ${slug}...`
  )
  try {
    return response.event.isOnline
  } catch (e) {
    console.log(`Got a bad response checking for online status of ${slug}`)
    throw e
  }
}

/** Asynchronously return a boolean indicating whether a representative set of the given event has stage data
 *
 * Set representatitive is chosen by the `MAGIC` sort type in Start.gg's GraphQL API
 *
 * GraphQL queries made: 1
 */
exports.eventSlugRepresentativeHasStageData = async (slug) => {
  const delayBetweenQueries = 1.3
  const response = await this.makeGraphQLRequestStubborn(
    checkRepresentativeSet.query,
    {
      slug,
    },
    delayBetweenQueries,
    `Checking if tournament [${slug}] reported stage data...`
  )
  try {
    const stageName = response.event.sets.nodes[0].games[0].stage.name
    const charId =
      response.event.sets.nodes[0].games[0].selections[0].selectionValue
    if (stageName && charId) {
      return true
    }
    return false
  } catch (e) {
    return false
  }
}

/** Return a boolean representing whether a given event should be considered to be processed
 *
 * As queried on Start.gg's API, `event` can be expected to have the following properties:
 * - `state`
 * - `slug`
 * - `numEntrants`
 * - `isOnline`
 */
exports.eventIsValid = (event) => {
  if (event.state === 'COMPLETED' && event.numEntrants >= 48) {
    return true
  }
}

/** DEPRECATED: use `getCompletedEventSlugsWithEntrantsInSinglePeriod` and filter events afterward locally instead of using this function
 *
 * Asynchronously return an array of slugs of events satisfying the condition `this.eventIsValid`
 *
 * Should only be used with "single periods," ie monthlong periods at most to prevent bumping up against Start.GG's API query limits (longer time periods should be chained calls of this function)
 *
 * GraphQL queries made: 1-40+
 *
 * Example usage:
 *
 * `const period = util.portionDateRange(2019, 1, 1, 2019, 1, 7)[0]`
 *
 * `console.log(await apiTools.findValidEventSlugsInSinglePeriod(period[0], period[1]))`
 */
exports.findValidEventSlugsInSinglePeriod = async (unixStart, unixEnd) => {
  const validSlugs = []
  const tournamentsPerPage = 50
  // delay in seconds
  const delayBetweenQueries = 1.3

  const handleResponse = (res) => {
    try {
      for (const tournament of res.tournaments.nodes) {
        for (const event of tournament.events) {
          if (this.eventIsValid(event)) {
            validSlugs.push(event.slug)
          }
        }
      }
    } catch (e) {
      console.log('Oops! Error')
    }
  }

  let response = await this.stallPromise(
    this.makeGraphQLRequestStubborn(
      findValidTournamentsInPeriod.query,
      {
        perPage: tournamentsPerPage,
        page: 1,
        after: unixStart,
        before: unixEnd,
      },
      delayBetweenQueries,
      '(1 of ?)'
    ),
    delayBetweenQueries
  )
  let lastPage
  try {
    lastPage = response.tournaments.pageInfo.totalPages
  } catch (e) {
    console.log("Couldn't find number of pages for some reason")
    throw e
  }

  handleResponse(response)

  for (let i = 2; i <= lastPage; i++) {
    response = await this.stallPromise(
      this.makeGraphQLRequestStubborn(
        findValidTournamentsInPeriod.query,
        {
          perPage: tournamentsPerPage,
          page: i,
          after: unixStart,
          before: unixEnd,
        },
        delayBetweenQueries,
        `(${i} of ${lastPage})`
      ),
      delayBetweenQueries
    )
    handleResponse(response)
  }

  return validSlugs
}

/** Asynchronously return a map of `slug, numEntrants` pairs of events in a single time period */
exports.getCompletedEventSlugsWithEntrantsInSinglePeriod = async (
  unixStart,
  unixEnd
) => {
  const slugs = new Map()
  const tournamentsPerPage = 50
  // delay in seconds
  const delayBetweenQueries = 1.3

  const handleResponse = (res) => {
    try {
      for (const tournament of res.tournaments.nodes) {
        for (const event of tournament.events) {
          if (event.state === 'COMPLETED') {
            slugs.set(event.slug, event.numEntrants)
          }
        }
      }
    } catch (e) {
      console.log(
        'Error handling response in getCompletedEventSlugsWithEntrantsInSinglePeriod'
      )
    }
  }

  let response = await this.stallPromise(
    this.makeGraphQLRequestStubborn(
      findValidTournamentsInPeriod.query,
      {
        perPage: tournamentsPerPage,
        page: 1,
        after: unixStart,
        before: unixEnd,
      },
      delayBetweenQueries,
      'Requesting tournament data: (1 of ?)'
    ),
    delayBetweenQueries
  )
  let lastPage
  try {
    lastPage = response.tournaments.pageInfo.totalPages
  } catch (e) {
    console.log(
      "Couldn't find number of pages for some reason when querying tournaments"
    )
    throw e
  }

  handleResponse(response)

  for (let i = 2; i <= lastPage; i++) {
    response = await this.stallPromise(
      this.makeGraphQLRequestStubborn(
        findValidTournamentsInPeriod.query,
        {
          perPage: tournamentsPerPage,
          page: i,
          after: unixStart,
          before: unixEnd,
        },
        delayBetweenQueries,
        `Requesting tournament data: (${i} of ${lastPage})`
      ),
      delayBetweenQueries
    )
    handleResponse(response)
  }

  return slugs
}

/** Asynchronously return a map of `slug, numEntrants` pairs of events in an arbitrary time period
 *
 * As implemented, tournaments may be up to 4 days before or 4 days after the given range as a measure to prevent missing tournaments that lie on the boundary of adjacent queries
 *
 * e.g. querying
 *
 * "June 3rd, 2019 to January 1st, 2020"
 * and
 * "January 1st, 2020 to April 9th, 2020"
 *
 * would miss a tournament that ran from December 29th, 2019 to January 6th, 2020 if it wasn't implemented this way
 */
exports.getCompletedEventSlugsWithEntrantsInLongPeriod = async (
  yStart,
  mStart,
  dStart,
  yEnd,
  mEnd,
  dEnd
) => {
  const periods = util.portionDateRange(
    yStart,
    mStart,
    dStart,
    yEnd,
    mEnd,
    dEnd
  )

  const fourDays = 4 * 24 * 60 * 60
  const allSlugs = new Map()

  let i = 1
  for (const period of periods) {
    console.log(`Gathering data -- batch ${i++} of ${periods.length}`)
    // offset start and end by four days, so that any tournament lasting less than 8 days on their boundary is caught by at least one of them
    const start = period[0] - fourDays
    const end = period[1] + fourDays
    const periodSlugs =
      await this.getCompletedEventSlugsWithEntrantsInSinglePeriod(start, end)
    for (const [key, value] of periodSlugs) {
      allSlugs.set(key, value)
    }
  }
  return allSlugs
}

/** Asynchronously return a map of `slug, numEntrants` pairs of events from `n` days ago until now
 *
 * NOTE: This function uses `this.getCompletedEventSlugsWithEntrantsInSinglePeriod` internally, and thus will fail to process a period of time with over 10,000 events in it. It is recommended to use `this.getCompletedEventSlugsWithEntrantsInLongPeriod` with specific dates for periods longer than a month
 *
 * As implemented, tournaments may be up to 4 days before or 4 days after the given range as a measure to prevent missing tournaments that lie on the boundary of adjacent queries
 *
 * e.g. querying
 *
 * "June 3rd, 2019 to January 1st, 2020"
 * and
 * "January 1st, 2020 to April 9th, 2020"
 *
 * would miss a tournament that ran from December 29th, 2019 to January 6th, 2020 if it wasn't implemented this way
 */
exports.getCompletedEventSlugsWithEntrantsInPastNDays = async (n) => {
  const dayInSeconds = 24 * 60 * 60
  const now = util.currentTimeUnixSeconds()

  return await this.getCompletedEventSlugsWithEntrantsInSinglePeriod(
    now - (n + 4) * dayInSeconds,
    now + 4 * dayInSeconds
  )
}

/** Asynchronously return an array of game objects from an event for games that have stage and character data
 *
 * Event slug should be previously vetted with `eventSlugRepresentativeHasStageData` as a heuristic for sets to have reported data
 */
exports.getGamesFromVettedEvent = async (slug) => {
  const games = []
  const setsPerPage = 22
  const delayBetweenQueries = 1.3

  let foundStageDataOnCurrentPage = false

  const handleResponse = (res) => {
    try {
      // for tournaments with over 10,000 sets of stage data, res.event will be `null` due to the start.gg API complexity limit (the response only contains an `errors array` and an `actionRecords` array)
      // in this case, there is no data to process, so just leave foundStageDataOnCurrentPage as false
      // this should occur for very few tournaments. as far as I am aware, there are only 2-5 tournaments where this occurs, and still the top 10,000 sets of stage data are recorded by this script
      if (res.errors) {
        if (
          res.errors[0].message === 'Cannot query more than the 10,000th entry'
        ) {
          console.log(
            `Reached 10,000 sets from event [${slug}], recording sets...`
          )
        } else {
          throw new Error(`Unhandled error message: ${res.errors[0].message}`)
        }
      } else if (res.event.sets) {
        for (const set of res.event.sets.nodes) {
          if (set.games) {
            for (const game of set.games) {
              if (
                game.winnerId &&
                game.stage &&
                game.stage.name &&
                game.selections &&
                game.selections.length === 2 &&
                game.selections[0].entrant &&
                game.selections[0].entrant.id &&
                game.selections[0].entrant.participants &&
                game.selections[0].entrant.participants.length > 0 && // in rare circumstances (see tournament/rushdown-online-6-smash-bros-and-fighting-game-tournament/events/smash-bros-ultimate-1v1) a game can have entrant data with an empty participants list (why?)
                // this is so rare that we can safely discard it
                game.selections[0].entrant.participants[0].player &&
                game.selections[0].entrant.participants[0].player.id &&
                game.selections[0].selectionValue &&
                game.selections[1].entrant &&
                game.selections[1].entrant.id &&
                game.selections[1].entrant.participants &&
                game.selections[1].entrant.participants.length > 0 &&
                game.selections[1].entrant.participants[0].player &&
                game.selections[1].entrant.participants[0].player.id &&
                game.selections[1].selectionValue
              ) {
                foundStageDataOnCurrentPage = true
                const entrant0Won =
                  game.selections[0].entrant.id === game.winnerId
                const winChar = entrant0Won
                  ? game.selections[0].selectionValue
                  : game.selections[1].selectionValue
                const loseChar = entrant0Won
                  ? game.selections[1].selectionValue
                  : game.selections[0].selectionValue
                const winEntrantId = entrant0Won
                  ? game.selections[0].entrant.id
                  : game.selections[1].entrant.id
                const loseEntrantId = entrant0Won
                  ? game.selections[1].entrant.id
                  : game.selections[0].entrant.id
                const winPlayerId = entrant0Won
                  ? game.selections[0].entrant.participants[0].player.id
                  : game.selections[1].entrant.participants[0].player.id
                const losePlayerId = entrant0Won
                  ? game.selections[1].entrant.participants[0].player.id
                  : game.selections[0].entrant.participants[0].player.id
                games.push({
                  winChar,
                  loseChar,
                  winEntrantId,
                  loseEntrantId,
                  winPlayerId,
                  losePlayerId,
                  stage: game.stage.name,
                  isOnline: res.event.isOnline,
                  gameId: game.id,
                  setId: set.id,
                  slug,
                })
              }
            }
          }
        }
      }
    } catch (e) {
      console.log('Error handling response in getGamesFromVettedEvent')
      throw e
    }
  }

  let response = await this.stallPromise(
    this.makeGraphQLRequestStubborn(
      getSetDataFromEvent.query,
      {
        perPage: setsPerPage,
        page: 1,
        slug,
      },
      delayBetweenQueries,
      'Requesting set data: (1 of ?)'
    ),
    delayBetweenQueries
  )
  let lastPage

  try {
    try {
      const errMsg = response.errors[0].message
      if (errMsg.includes('Your query complexity is too high')) {
        console.log(
          `Query complexity for [${slug}] too high, probably ran sets larger than Bo5`
        )
        return games
      }
    } catch (e) {}
    lastPage = response.event.sets.pageInfo.totalPages
  } catch (e) {
    console.log(
      `Couldn't find number of pages for some reason when querying sets from event '${slug}'`
    )
    throw e
  }
  handleResponse(response)

  for (let i = 2; i <= lastPage; i++) {
    if (!foundStageDataOnCurrentPage) {
      console.log(
        `[${slug}] Queried ${setsPerPage} sets without data, abandoning search`
      )
      return games
    }
    foundStageDataOnCurrentPage = false
    response = await this.stallPromise(
      this.makeGraphQLRequestStubborn(
        getSetDataFromEvent.query,
        {
          perPage: setsPerPage,
          page: i,
          slug,
        },
        delayBetweenQueries,
        `Requesting set data: (${i} of ${lastPage})`
      ),
      delayBetweenQueries
    )
    handleResponse(response)
  }

  return games
}

/** ONLY FOR USE DEBUGGING
 *
 * Print out sets and games with stage data found from an event slug
 *
 * Event slug should be previously vetted with `eventSlugRepresentativeHasStageData` as a heuristic for sets to have reported data
 */
exports.prettyPrintStageDataFromVettedEvent = async (slug) => {
  const char = require('./charIdTools')

  let lastSet = -1
  let setCount = 1
  let gameNumber = 1
  const games = await this.getGamesFromVettedEvent(slug)

  for (const game of games) {
    if (game.setId !== lastSet) {
      console.log(`DATA FOR SET ${setCount}:`)
      lastSet = game.setId
      setCount += 1
      gameNumber = 1
    }
    console.log(
      `GAME ${gameNumber++}: ${char.toName[game.winChar]} beats ${
        char.toName[game.loseChar]
      } on ${game.stage}`
    )
  }
}

/** Asynchronously return an object { entrantID, playerID, gamerTag } */
exports.getPlayerInfoFromEntrantID = async (entrantID) => {
  const delayBetweenQueries = 1.3

  let response = await this.makeGraphQLRequestStubborn(
    getPlayerInfoFromEntrantID.query,
    { entrantID },
    delayBetweenQueries
  )

  try {
    const playerID = response.entrant.participants[0].player.id
    const gamerTag = response.entrant.participants[0].player.gamerTag
    return { entrantID, playerID, gamerTag }
  } catch (e) {
    console.log(
      "Couldn't read attributes of getPlayerInfoFromEntrantID response for some reason"
    )
    throw e
  }
}

/** Asynchronously return an object { playerID, gamerTag } */
exports.getPlayerInfoFromPlayerID = async (playerID) => {
  const delayBetweenQueries = 1.3

  let response = await this.makeGraphQLRequestStubborn(
    getPlayerInfoFromPlayerID.query,
    { playerID },
    delayBetweenQueries
  )

  try {
    const gamerTag = response.player.gamerTag
    return { entrantID, playerID, gamerTag }
  } catch (e) {
    console.log(
      "Couldn't read attributes of getPlayerInfoFromPlayerID response for some reason"
    )
    throw e
  }
}

/** Asynchronously return a length 2 array containing objects { entrantID, playerID, gamerTag } for a given set */
exports.getPlayerInfoFromSetID = async (setID) => {
  const delayBetweenQueries = 1.3

  let response = await this.makeGraphQLRequestStubborn(
    getPlayerInfoFromSetID.query,
    { setID },
    delayBetweenQueries
  )

  try {
    const out = []
    for (let i = 0; i < 2; i++) {
      const entrantID = response.set.slots[i].entrant.id
      const playerID = response.set.slots[i].entrant.participants[0].player.id
      const gamerTag =
        response.set.slots[i].entrant.participants[0].player.gamerTag

      out.push({ entrantID, playerID, gamerTag })
    }

    return out
  } catch (e) {
    console.log(
      "Couldn't read attributes of getPlayerInfoFromSetID response for some reason"
    )
    throw e
  }
}
