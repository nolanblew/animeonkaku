import { z } from "zod";

export const lidarrArtistSchema = z.object({
  id: z.number().int().nonnegative().optional().default(0),
  artistName: z.string().min(1),
  foreignArtistId: z.string().min(1),
  monitored: z.boolean().optional(),
  monitorNewItems: z.enum(["all", "none", "new"]).optional(),
  qualityProfileId: z.number().int().nonnegative().optional(),
  metadataProfileId: z.number().int().nonnegative().optional(),
  rootFolderPath: z.string().nullish(),
  tags: z.array(z.number().int().positive()).optional(),
}).passthrough();

export const lidarrImageSchema = z.object({
  coverType: z.string().nullish(),
  remoteUrl: z.string().nullish(),
  url: z.string().nullish(),
}).passthrough();

export const lidarrAlbumSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  foreignAlbumId: z.string().min(1),
  title: z.string().min(1),
  artistId: z.number().int().nonnegative().optional(),
  monitored: z.boolean().optional().default(false),
  releaseDate: z.string().nullish(),
  artist: lidarrArtistSchema,
  images: z.array(lidarrImageSchema).optional().default([]),
}).passthrough();

export const lidarrAlbumsSchema = z.array(lidarrAlbumSchema);

export const lidarrCommandSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullish(),
  status: z.string().optional(),
  message: z.string().nullish(),
  body: z.object({ albumIds: z.array(z.number().int().positive()).optional() }).passthrough().optional(),
}).passthrough();
export const lidarrCommandsSchema = z.array(lidarrCommandSchema);

export const lidarrQueueSchema = z.object({
  records: z.array(z.object({
    albumId: z.number().int().positive().optional(),
    status: z.string().nullish(),
    trackedDownloadStatus: z.string().nullish(),
    errorMessage: z.string().nullish(),
  }).passthrough()).default([]),
}).passthrough();

export const lidarrHistorySchema = z.object({
  records: z.array(z.object({
    albumId: z.number().int().positive().optional(),
    eventType: z.string().optional(),
  }).passthrough()).default([]),
}).passthrough();

export const lidarrTrackSchema = z.object({
  id: z.number().int().positive(),
  albumId: z.number().int().positive(),
  trackFileId: z.number().int().nonnegative().optional(),
  foreignTrackId: z.string().nullish(),
  foreignRecordingId: z.string().nullish(),
  title: z.string().min(1),
  duration: z.number().nonnegative().optional(),
  mediumNumber: z.number().int().positive().optional(),
  absoluteTrackNumber: z.number().int().positive().optional(),
  trackNumber: z.string().nullish(),
}).passthrough();

export const lidarrTracksSchema = z.array(lidarrTrackSchema);

export const lidarrTrackFileSchema = z.object({
  id: z.number().int().positive(),
  albumId: z.number().int().positive(),
  path: z.string().min(1),
  size: z.number().nonnegative().optional(),
  mediaInfo: z.object({ runTime: z.string().nullish() }).passthrough().nullish(),
}).passthrough();

export const lidarrTrackFilesSchema = z.array(lidarrTrackFileSchema);

export const lidarrSystemStatusSchema = z.object({ version: z.string().min(1) }).passthrough();

export type LidarrAlbum = z.infer<typeof lidarrAlbumSchema>;
export type LidarrTrack = z.infer<typeof lidarrTrackSchema>;
export type LidarrTrackFile = z.infer<typeof lidarrTrackFileSchema>;
