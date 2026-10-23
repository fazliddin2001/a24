import { Avatar3DController } from './avatar3d.js';

/**
 * AvatarController wrapper: Connects the 3D Three.js avatar to the application
 */
export class AvatarController extends Avatar3DController {
  constructor(avatarElement, statusTextElement, statusDotElement, statusSection) {
    super(avatarElement, statusTextElement, statusDotElement, statusSection);
  }
}
