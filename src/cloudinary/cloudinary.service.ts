import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly allowedMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf',
  ];
  private readonly maxBytes = 10 * 1024 * 1024;

  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(file: Express.Multer.File, folder = 'ticketr'): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file was uploaded');
    }
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only PNG, JPG, WEBP, GIF or PDF files are allowed');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException('Files must be smaller than 10MB');
    }

    const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image';

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          quality: 'auto',
          timeout: 60000,
        },
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error(`Upload failed for ${folder}`, error as any);
            return reject(new BadRequestException('We could not store that file. Please retry.'));
          }
          resolve(result.secure_url);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }
}
