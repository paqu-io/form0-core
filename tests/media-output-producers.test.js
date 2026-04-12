import assert from 'node:assert/strict';
import { FIELD_SPECS } from '../src/index.js';

const photoField = { data_name: 'photos' };
const videoField = { data_name: 'videos' };
const signatureField = { data_name: 'signature' };

const photoOutput = FIELD_SPECS.PhotoField.outputProducer(photoField, [
  {
    photo_id: 'photo-client-id',
    media_id: 'media-client-id',
    asset_id: 'asset-id',
    upload_id: 'upload-id',
    upload_status: 'ready',
    original_filename: 'photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    attached_at_client: '2026-04-12T10:00:00.000Z',
    captured_at_client: '2026-04-12T09:59:00.000Z',
    ignored_runtime_value: 'not persisted',
  },
]);

assert.deepEqual(photoOutput, [
  {
    photo_id: 'photo-client-id',
    media_id: 'media-client-id',
    filename: 'photo.jpg',
    caption: null,
    asset_id: 'asset-id',
    upload_id: 'upload-id',
    upload_status: 'ready',
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    original_filename: 'photo.jpg',
    attached_at_client: '2026-04-12T10:00:00.000Z',
    captured_at_client: '2026-04-12T09:59:00.000Z',
  },
]);

const videoOutput = FIELD_SPECS.VideoField.outputProducer(videoField, [
  {
    video_id: 'video-client-id',
    asset_id: 'video-asset-id',
    original_filename: 'clip.mp4',
    duration: 42,
    mime_type: 'video/mp4',
    size_bytes: 9876,
    attached_at_client: '2026-04-12T11:00:00.000Z',
  },
]);

assert.deepEqual(videoOutput, [
  {
    video_id: 'video-client-id',
    media_id: 'video-client-id',
    filename: 'clip.mp4',
    duration: 42,
    caption: null,
    asset_id: 'video-asset-id',
    mime_type: 'video/mp4',
    size_bytes: 9876,
    original_filename: 'clip.mp4',
    attached_at_client: '2026-04-12T11:00:00.000Z',
  },
]);

const signatureOutput = FIELD_SPECS.SignatureField.outputProducer(signatureField, {
  signature_id: 'signature-client-id',
  media_id: 'signature-media-id',
  asset_id: 'signature-asset-id',
  upload_status: 'ready',
  preview_url: '/v1/media/assets/signature-asset-id/variant/preview',
  signed_at_client: '2026-04-12T12:00:00.000Z',
});

assert.deepEqual(signatureOutput, {
  signature_id: 'signature-client-id',
  media_id: 'signature-media-id',
  data: null,
  asset_id: 'signature-asset-id',
  upload_status: 'ready',
  preview_url: '/v1/media/assets/signature-asset-id/variant/preview',
  signed_at_client: '2026-04-12T12:00:00.000Z',
});

console.log('Media output producer tests passed.');
