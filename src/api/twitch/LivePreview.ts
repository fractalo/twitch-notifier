import axios, { AxiosInstance } from 'axios';
import { HttpHeaders } from '../../constant/axios';
import { isNumString } from '../../util';
import { STATIC_BASE_URL } from '../../constant/twitch';

export interface LivePreviewImage {
    data: Buffer;
    url: string;
}

export const LivePreview = {
    get404ImageUrl(size?: {width: string, height: string}) {
        if (!size || !isNumString(size.width) || !isNumString(size.height)) {
            size = {width: '1920', height: '1080'};
        }
        return `${STATIC_BASE_URL}/ttv-static/404_preview-${size.width}x${size.height}.jpg`;
    },

    getImageUrl(loginName: string) {
        const cacheBuster = Date.now().toString();
        const int64OverflowNum = cacheBuster.padEnd(20, '0');
        const width = int64OverflowNum;
        const height = int64OverflowNum;
        return `${STATIC_BASE_URL}/previews-ttv/live_user_${loginName}-${width}x${height}.jpg`
    },

    async getImage(loginName: string) {
        const url = this.getImageUrl(loginName);
        return axios.get<Buffer>(url, {
            headers: {
                'User-Agent': HttpHeaders.userAgents.desktop,
            },
            maxRedirects: 0,
            responseType: 'arraybuffer',
        })
        .then(response => ({ data: response.data, url } as LivePreviewImage))
        .catch(() => null);
    }
}
