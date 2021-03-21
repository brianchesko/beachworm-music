import { useContext, createContext, useState, useEffect, useRef } from "react";
import { refreshSpotifyToken }  from './../api/authenticationApi';
import { playTrack } from './../api/spotifyApi';
import { listenToSong } from './../api/songAPI';
import { useAuth } from './../hooks/authHooks';
import WebPlaybackReact from './WebPlaybackReact';

const sdkContext = createContext();

export function useSpotifySdk() {
  return useContext(sdkContext);
}

export function ProvideSpotify({ children }) {
  const auth = useAuth();
  const spotifyTokenRef = useRef(null);
  const deviceIdRef = useRef(null);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [playerSelected, setPlayerSelected] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerState, setPlayerState] = useState({});
  const [stateCallbacks, setStateCallbacks] = useState({});
  const [onReadyCallbacks, setOnReadyCallbacks] = useState({});
  const [onDeviceSelectedCallbacks, setOnDeviceSelectedCallbacks] = useState({});
  const [playerRef, setPlayerRef] = useState(null);

  const [trackEnded, setTrackEnded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(null);
  const [songHistory, setSongHistory] = useState([]);

  const [sessionSongHistoryStack, setSessionHistoryStack] = useState([]);

  const handleNewState = async (nextState) => {
    // update our pause button
    if (nextState) {
      setPlaying(!nextState.paused);
      
      if (!nextState.paused) {
        setTrackEnded(false);
      }

      if (playerRef) {
        setVolume(await playerRef.getVolume());
      }
    }

    // check for the end of the track
    // spotify doesn't have any sort of "song ended" callback sadly,
    // so this borrows from this answer: https://github.com/spotify/web-playback-sdk/issues/35#issuecomment-509159445
    if (!trackEnded && playerState
      && nextState.track_window.previous_tracks.find(x => x.id === nextState.track_window.current_track.id)
      && !playerState.paused
      && nextState.paused) {
        setTrackEnded(true);
        const prevSongId = nextState.track_window.current_track.id;
        setSessionHistoryStack([...sessionSongHistoryStack, prevSongId]);
    }
  };

  const addOnReadyListeners = (keyCallbackPairs) => {
    Object.entries(keyCallbackPairs).forEach(entry => {
      console.log('Registered onReady callback:', entry[0]);
    });
    setOnReadyCallbacks({...onReadyCallbacks, ...keyCallbackPairs});
  }

  const addOnDeviceSelectedListeners = (keyCallbackPairs) => {
    Object.entries(keyCallbackPairs).forEach(entry => {
      console.log('Registered onDeviceSelected callback:', entry[0]);
    });
    setOnDeviceSelectedCallbacks({...onDeviceSelectedCallbacks, ...keyCallbackPairs});
  }

  const addStateListeners = (keyCallbackPairs) => {
    // TODO: fix this. right now, it thinks stateCallbacks is empty even after adding
    // a listener, so if you try to add a second listener it essentially overwrites the first
    Object.entries(keyCallbackPairs).forEach(entry => {
      console.log('Registered onStateChanged callback:', entry[0]);
    });
    const allCallbacks = {...stateCallbacks, ...keyCallbackPairs};
    setStateCallbacks(allCallbacks);
    console.log('New state callbacks registered. All callbacks: ', allCallbacks);
  };

  const webPlaybackSdkProps = {
    playerName: "BeachWorm Player",
    playerInitialVolume: 1.0,
    playerRefreshRateMs: 100,
    playerAutoConnect: true,
    onPlayerRequestAccessToken: (async () => {
      if (!spotifyTokenRef.current) {
        if (auth.user) {
          const newToken = await refreshSpotifyToken().then(result => {
            spotifyTokenRef.current = result;
            localStorage.setItem('spotify_access_token', result)
          }, reject => {
            return null;
          });
          return newToken;
        }
        return null;
      }
      return spotifyTokenRef.current;
    }),
    onPlayerLoading: (() => setPlayerLoaded(true)),
    onPlayerWaitingForDevice: (data => {
      setPlayerSelected(false); 
      setPlayerReady(true);
      deviceIdRef.current = data.device_id;
      Object.entries(onReadyCallbacks).forEach(entry => {
        entry[1](data);
      });
    }),
    onPlayerDeviceSelected: () => {
      setPlayerSelected(true);
      // notify all stored listeners
      Object.entries(onDeviceSelectedCallbacks).forEach(entry => entry[1]());
    },
    onPlayerStateChange: (newState) => {
      setPlayerState(newState);
      // update other state vars locally
      handleNewState(newState);
      // notify all stored listeners
      Object.entries(stateCallbacks).forEach(entry => entry[1](newState));
    },
    onPlayerError: (playerError => console.error(playerError))
  };

  return (
    <sdkContext.Provider value={useProvideSdk()}>
      {/* remove the player from the hierarchy if there's no user logged in */}
      {auth.user ? (
        <WebPlaybackReact {...webPlaybackSdkProps} ref={(e) => e ? setPlayerRef(e.webPlaybackInstance) : setPlayerRef(e)}>
          {children}
        </WebPlaybackReact>
      ) : children}
    </sdkContext.Provider>
  );

  function useProvideSdk() {
    const [contextPlayQueue, setContextPlayQueue] = useState({ 'name': undefined, 'songs': [], 'getMoreSongs': undefined });
    const [userPlayQueue, setUserPlayQueue] = useState([]);
    const [shuffle, setShuffle] = useState(false);
    const [muted, setMuted] = useState(false);
    const [autoplay, setAutoplay] = useState(true);

    useEffect(() => {
      const playNext = async () => {
        if (trackEnded) {
          // TODO: fire 'listened to' endpoint to add to user history
          console.log('Track ending detected');
          if (autoplay) {
            const nextSong = await dequeueNextSong(shuffle);
            if (nextSong) {
              refreshWrapper(play)(nextSong.id);
            }
          }
        }
      };

      playNext();
    }, [trackEnded]);
  
    // const onlyIfLoadedWrapper = (callback) => {
    //   if (isPlayerLoaded) {
    //     return (params) => callback(params);
    //   } else {
    //     console.error('Cannot use ' + callback.name + ' before player is loaded!');
    //   }
    // }
  
    const refreshToken = async () => {
      return refreshSpotifyToken().then(result => {
        if (result) {
          spotifyTokenRef.current = result.access_token;
          localStorage.setItem('spotify_access_token', result.access_token);
          return Promise.resolve(result);
        } else {
          return Promise.reject('No access token from endpoint');
        }
      }, _reject => {
        console.log('Access token failed to refresh')
      });
    };
  
    const refreshAndTry = async (callback, parameters, firstTry) => {
      const attempt = async () => {
        return await new Promise(parameters ? () => callback(parameters) : callback)
        .catch(async e => {
          console.log('Error in refreshable function', e);
          if (firstTry) {
            console.log('Attempting to retrieve new Spotify token');
            await refreshToken();
            return refreshAndTry(callback, parameters, false);
          } else {
            return Promise.reject('Too many attempts, giving up');
          }
        });
      };
  
      // if spotify endpoint tells us we don't have the auth, refresh token and try again
      if (!spotifyTokenRef.current) {
        console.log(`Called a Spotify auth-required function, but we have no access token. Will try to refresh token then attempt.`);
        return refreshToken().then(result => {
          console.log('Attempt succeeded, received token', result);
          return attempt();
        }, _reject => {
          console.log('Attempt to refresh token failed. Giving up.');
          return Promise.reject();
        });
      } else {
        return attempt();
      }
    }
  
    const refreshWrapper = (callback) => {
      return (parameters) => refreshAndTry(callback, parameters, true);
    };
  
    const pause = async () => {
      console.log('Pausing current song');
      return playerRef.pause();
    };
  
    const play = async (songId) => {
      if (songId) {
        return playTrack(songId, deviceIdRef.current, spotifyTokenRef.current).then(async _ => {
          return await listenToSong(songId).then(history => {
            console.log('Logged listen to song ' + songId);
            setSongHistory(history.history);
            return Promise.resolve(history.history);
          }, _reject => {
            console.log('Failed to log song listen for song ' + songId);
            return Promise.resolve(null); // not a deal-breaker, just resolve anyway
          });
        }, reject => {
          return Promise.reject(reject);
        });
      } else {
        console.log('Resuming current track');
        return playerRef.resume();
      }
    };
  
    const togglePlaying = async () => {
      console.log('Toggling playback status');
      if (!playerState.track_window || !playerState.track_window.current_track) {
        console.log('No song playing, dequeuing and playing');
        const nextSong = await dequeueNextSong();
        // console.log(nextSong);
        if (nextSong) {
          return play(nextSong.id);
        }
      } else {
        return playerRef.togglePlay();
      }
    };
  
    const seek = async (millis) => {
      const seconds = Math.floor(millis / 1000) % 60;
      const minutes = Math.floor(millis / 1000 / 60);
      console.log('Skipping to time ' + (minutes) + ':' + seconds);
      return playerRef.seek(millis);
    };
  
    // adds a list of songs to the context play queue.
    // context here means that they're added because of where the user is,
    // not because the user specifically requested. for example,
    // if you play a song in the middle of a playlist, the following songs
    // in the playlist should be added here.
    const addToContextPlayQueue = (songs) => {
      setContextPlayQueue({
        name: contextPlayQueue.name,
        songs: [...contextPlayQueue.songs, ...songs],
        getMoreSongs: contextPlayQueue.getMoreSongs,
      });
    }
  
    // adds a list of songs to the user requested play queue. this queue
    // always has priority over the context queue. for example, if the user
    // is currently playing a playlist, but presses the "add to queue" button
    // on a specific song, that song will play BEFORE the songs in 
    // the current playlist context
    const addToUserPlayQueue = (songs) => {
      setUserPlayQueue([...userPlayQueue, ...songs]);
    }
  
    const clearUserPlayQueue = () => {
      console.log('Clearing user play queue');
      setUserPlayQueue([]);
    }
  
    const clearContextPlayQueue = () => {
      console.log('Clearing context play queue');
      setContextPlayQueue({ name: undefined, songs: [], getMoreSongs: undefined });
    }
  
    // TODO: rework shuffle index or rng seed to a state variable so that
    // peek and dequeue return the same song
    const dequeueNextSong = async () => {
      // regardless of shuffle status, always try to take the front of the play queue first
      if (userPlayQueue.length) {
        const song = userPlayQueue[0];
        setUserPlayQueue(userPlayQueue.slice(1));
        return song;
      } else if (contextPlayQueue.songs.length) {
        // if play queue is empty, generate an index in the context queue and pop it while removing everything else
        const index = shuffle ? Math.floor(Math.random() * contextPlayQueue.songs.length) : 0;
        const contextSongs = contextPlayQueue.songs;
        const removed = contextSongs[index];
        const songsRemaining = [...contextSongs.slice(0, index), ...contextSongs.slice(index + 1)];
        // if we run out of songs and we have a way to get more, do that
        if (songsRemaining.length === 0 && contextPlayQueue.getMoreSongs) {
          console.log('Ran out of songs. Attempting to retrieve more.');
          const newSongs = await contextPlayQueue.getMoreSongs().then(
            songs => Promise.resolve(songs),
            _reject => Promise.resolve([]),
          );
          songsRemaining.push(...newSongs);
        }
        setContextPlayQueue({
          name: contextPlayQueue.name,
          songs: songsRemaining,
          getMoreSongs: contextPlayQueue.getMoreSongs,
        });
        return removed;
      } else {
        return null;
      }
    }

    const peekNextSong = () => {
      // regardless of shuffle status, always try to take the front of the play queue first
      if (userPlayQueue.length) {
        return userPlayQueue[0];
      } else if (contextPlayQueue.songs.length) {
        // if user play queue is empty, generate an index from the context queue
        const index = shuffle ? Math.floor(Math.random() * contextPlayQueue.songs.length) : 0;
        return contextPlayQueue.songs[index];
      } else {
        return null;
      }
    }
  
    const getUserPlayQueue = () => {
      return [...userPlayQueue];
    }
  
    const getContextPlayQueue = () => {
      return contextPlayQueue;
    }
  
    const deleteUserQueueSong = (index) => {
      console.log('Deleting index ' + index + ' from user queue');
      setUserPlayQueue([...userPlayQueue.slice(0, index), ...userPlayQueue.slice(index + 1)]);
    }
  
    const deleteContextQueueSong = (index) => {
      console.log('Deleting index ' + index + ' from context queue');
      setContextPlayQueue({
        name: contextPlayQueue.name,
        songs: [...contextPlayQueue.songs.slice(0, index), ...contextPlayQueue.songs.slice(index + 1)],
        getMoreSongs: contextPlayQueue.getMoreSongs,
      });
    }
  
    const setVolume = (volume) => {
      const roundedVol = Math.round(volume * 100000) / 1000;
      console.log('Setting volume to ' + volume + ' (' + roundedVol + '%)');
      return playerRef.setVolume(volume);
    }

    const skip = async () => {
      const refreshWrappedPlay = refreshWrapper(play);
      const nextSong = await dequeueNextSong();
      const trackWindow = playerState && playerState.track_window;
      const currentTrack = trackWindow && trackWindow.current_track;
      if (nextSong) {
        if (currentTrack) {
          setSessionHistoryStack([...sessionSongHistoryStack, currentTrack.id]);
        }
        await refreshWrappedPlay(nextSong.id);
      }
    }

    const playPrevious = async () => {
      if (sessionSongHistoryStack.length) {
        const trackWindow = playerState && playerState.track_window;
        const currentTrack = trackWindow && trackWindow.current_track;
        const prevSongId = sessionSongHistoryStack[sessionSongHistoryStack.length - 1];
        // remove last song id from stack
        setSessionHistoryStack([...sessionSongHistoryStack.slice(0, sessionSongHistoryStack.length - 1)]);
        // push currently playing to user queue
        if (currentTrack) {
          setUserPlayQueue([currentTrack, ...userPlayQueue]);
        }
        // play the previous song
        console.log('Moving to previous track ' + prevSongId);
        await playTrack(prevSongId, deviceIdRef.current, spotifyTokenRef.current);
      }
    }
  
    return {
      // current song controls
      resume: refreshWrapper(() => play()),
      pause: refreshWrapper(pause),
      play: refreshWrapper(play),
      togglePlay: refreshWrapper(togglePlaying),
      seek: refreshWrapper(seek),
      skip: skip,
      playPrevious: playPrevious,
      // general playback/info controls
      isPlaying: () => playing,
      setShuffle: setShuffle,
      isShuffling: () => shuffle,
      dequeueNextSong: dequeueNextSong,
      peekNextSong: peekNextSong,
      setAutoplay: setAutoplay,
      isAutoplaying: () => autoplay,
      // volume controls
      setVolume: setVolume,
      getVolume: () => volume,
      isMuted: () => muted,
      setMuted: setMuted,
      // up next (queue) controls
      getUserPlayQueue: getUserPlayQueue,
      addToUserPlayQueue: addToUserPlayQueue,
      deleteUserQueueSong: deleteUserQueueSong,
      clearUserPlayQueue: clearUserPlayQueue,
      setUserPlayQueue: setUserPlayQueue,
      getContextPlayQueue: getContextPlayQueue,
      addToContextPlayQueue: addToContextPlayQueue,
      deleteContextQueueSong: deleteContextQueueSong,
      clearContextPlayQueue: clearContextPlayQueue,
      setContextPlayQueue: setContextPlayQueue,
      // various functions
      addStateListeners: addStateListeners,
      addOnReadyListeners: addOnReadyListeners,
      addOnDeviceSelectedListeners: addOnDeviceSelectedListeners,
      getPlayerState: () => playerState,
      isPlayerReady: () => playerReady,
    };
  }
}