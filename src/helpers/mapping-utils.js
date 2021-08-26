const fs = require('fs');
const path = require('path');
const MultiStoreUtils = require('./multistore-utils');

class MappingUtils {

    static async updateProductMapping (attributes = [], storeCode) {
        try {
            const getFilterableAttributes = () => {
                return attributes.filter(attribute => {
                    return attribute.is_filterable
                        && attribute.is_visible_on_front === '1'
                        && (attribute.frontend_input === 'select' || attribute.frontend_input === 'multiselect' || attribute.frontend_input === 'boolean');
                })
            };

            const assignFilterableAttributes = (currentMapping, filterableAttributes = []) => {
                const output = { ...currentMapping };
                filterableAttributes.forEach(att => {
                    if (output && output.hasOwnProperty('mappings') && output.mappings.hasOwnProperty('properties')) {
                        if (!output.mappings.properties.hasOwnProperty(att.attribute_code)) {
                            Object.assign(output.mappings.properties, {
                                [att.attribute_code]: {
                                    type: 'keyword'
                                }
                            });
                        }

                        if (output.mappings.properties.hasOwnProperty('configurable_children') && !output.mappings.properties.configurable_children.properties.hasOwnProperty(att.attribute_code)) {
                            Object.assign(output.mappings.properties.configurable_children.properties, {
                                [att.attribute_code]: {
                                    type: 'keyword'
                                }
                            })
                        }
                    }
                });

                return output;
            };

            let mappingFileName = MultiStoreUtils.isDefaultStoreView(storeCode) ? 'mapping.json' : `mapping_${storeCode}.json`;
            const doesMappingFileExists = fs.existsSync(path.resolve(process.cwd(), 'config', mappingFileName));

            if (!doesMappingFileExists) {
                mappingFileName = 'mapping.json';
            }

            const mappingsPath = path.resolve(process.cwd(), 'config', mappingFileName);
            const mappingBuffer = fs.readFileSync(mappingsPath);
            const mapping = JSON.parse(mappingBuffer);
            const filterableAttributes = getFilterableAttributes();
            const newMapping = assignFilterableAttributes(mapping, filterableAttributes);

            fs.writeFileSync(mappingsPath, JSON.stringify(newMapping, null, 2));
            logger.info(`Updated mappings file in: ${mappingsPath}`);

            return newMapping;
        } catch (e) {
            logger.error(`Cannot update mapping file`, e.message || e);
            throw e;
        }
    }
}

module.exports = MappingUtils;
