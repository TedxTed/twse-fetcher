import axios from "axios";
import { JSDOM } from "jsdom";
import * as R from "ramda";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();

class TwseHistoricalDataFetcher {
    _startDate;
    _endDate;
    _stockIDs;

    constructor({ startDate, endDate, stockIDs }) {
        this.url = "https://mops.twse.com.tw/mops/web/ezsearch_query";
        this._startDate = startDate;
        this._endDate = endDate;
        this._stockIDs = stockIDs;
    }

    async run() {
        console.log(
            `Starting data fetch for date range: ${this._startDate} to ${this._endDate}`,
        );
        const data = await this._fetchAndPopulateData(
            this._startDate,
            this._endDate,
        );
        console.log(
            `Initial data fetch complete. Received ${data.length} items.`,
        );

        const getHyperlink = (v) => v.hyperlink;
        const createNoDataDiv = (stockId) =>
            `<p>stock id: ${stockId}</p><div>${stockId} 無資料</div>`;

        const processStockId = async (stockId) => {
            console.log(`Processing stock ID: ${stockId}`);
            const item = data.find((v) => v.companyId === stockId);
            if (item) {
                console.log(
                    `Found data for stock ID: ${stockId}. Fetching details...`,
                );
                const detailData = await this._fetchDetailData(
                    getHyperlink(item),
                );
                if (detailData) {
                    console.log(
                        `Detail data fetched successfully for stock ID: ${stockId}`,
                    );
                    return `<p>stock id: ${stockId}</p>${detailData}`;
                } else {
                    console.log(
                        `No detail data available for stock ID: ${stockId}`,
                    );
                    return createNoDataDiv(stockId);
                }
            }
            console.log(`No data found for stock ID: ${stockId}`);
            return createNoDataDiv(stockId);
        };

        console.log(`Processing ${this._stockIDs.length} stock IDs...`);
        const results = await Promise.all(this._stockIDs.map(processStockId));
        console.log(`All stock IDs processed. Generating HTML content...`);

        const htmlContent = this._generateHtmlContent(results);
        console.log(`HTML content generated. Saving file...`);

        await this._saveHtmlFile(htmlContent);
        console.log("HTML file has been generated and saved.");
    }

    _createPostData = (defaultParams) => {
        return R.pipe(
            R.toPairs,
            R.map(([key, value]) => `${key}=${encodeURIComponent(value)}`),
            R.join("&"),
        )(defaultParams);
    };

    async _fetchAndPopulateData(startDate, endDate) {
        console.log(`Fetching data for date range: ${startDate} to ${endDate}`);
        const defaultParams = {
            RADIO_CM: 1,
            step: "00",
            TYPEK: "sii",
            CO_MARKET: 17,
            CO_ID: "",
            PRO_ITEM: "",
            SUBJECT: "自結",
            SDATE: startDate,
            EDATE: endDate,
            lang: "TW",
            AN: "",
        };

        const postData = this._createPostData(defaultParams);

        try {
            const response = await axios.post(this.url, postData, {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded;charset=UTF-8",
                },
            });

            const toCamelCase = R.pipe(
                R.toLower,
                R.replace(/[-_](.)/g, (_, char) => char.toUpperCase()),
            );

            const adaptData = R.map(
                R.pipe(
                    R.toPairs,
                    R.map(([key, value]) => [toCamelCase(key), value]),
                    R.fromPairs,
                ),
            );

            const processData = R.pipe(R.path(["data", "data"]), adaptData);

            return processData(response);
        } catch (error) {
            console.error("Error details:", error);
            throw new Error(`Failed to fetch data: ${error.message}`);
        }
    }

    _generateHtmlContent(results) {
        const tableContent = results.join("<br/><br/><br/>");
        return `
            <!DOCTYPE html>
            <html lang="zh-TW">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TWSE Historical Data</title>
                <style>
                    body { font-family: Arial, sans-serif; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    h1 { color: #333; font-size: 24px; margin-top: 30px; }
                </style>
            </head>
            <body>
                ${tableContent}
            </body>
            </html>
        `;
    }

    async _saveHtmlFile(htmlContent) {
        const now = dayjs().tz("Asia/Taipei");
        const dateString = now.format("YYYY-MM-DD");
        const timeString = now.format("HHmm");

        const fileName = `twse_historical_data_${dateString}_${timeString}.xls`;
        const filePath = path.join(process.cwd(), fileName);

        await fs.writeFile(filePath, htmlContent, "utf8");
        console.log(`File saved to: ${filePath}`);
    }

    _createDetailLink = R.curry((baseUrl, params) => {
        const defaultParams = {
            encodeURIComponent: "1",
            firstin: "true",
            b_date: "",
            e_date: "",
            TYPEK: "sii",
            type: "",
            MEETING_STEP: "",
            MODEL: "",
            ITEM: "",
            e_month: "all",
            step: "2",
            off: "1",
        };

        const mergedParams = R.mergeRight(defaultParams, params);
        const queryParams = new URLSearchParams(mergedParams);
        return `${baseUrl}?${queryParams.toString()}`;
    });

    async _fetchDetailData(detailLink) {
        try {
            const response = await axios.get(detailLink);
            const document = new JSDOM(response.data).window.document;
            const table = document.querySelector("table.hasBorder");
            return table ? table.outerHTML : null;
        } catch (error) {
            console.error("Error fetching detail data:", error);
            return null;
        }
    }
}

const run = async () => {
    const stockIDs = process.env.STOCK_IDS
        ? process.env.STOCK_IDS.split(",")
        : [];

    if (stockIDs.length === 0) {
        console.error(
            "No stock IDs provided. Please set the STOCK_IDS environment variable.",
        );
        process.exit(1);
    }

    const fetcher = new TwseHistoricalDataFetcher({
        startDate: process.env.START_DATE,
        endDate: process.env.END_DATE,
        stockIDs: stockIDs,
    });
    await fetcher.run();
};

run();
